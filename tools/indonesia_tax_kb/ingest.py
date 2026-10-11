"""Offline/admin ingestion only. Official documents are data, never instructions.
Python 3 + pdfplumber/pypdf. No OCR, embeddings or production writes.
"""
import argparse
import hashlib
import json
import re
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOSTS = {'jdih.kemenkeu.go.id', 'www.jdih.kemenkeu.go.id', 'pajak.go.id',
         'www.pajak.go.id', 'peraturan.go.id', 'peraturan.bpk.go.id'}
MAX_BYTES = 24 * 1024 * 1024

def digest(data):
    return hashlib.sha256(data).hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    tmp.replace(path)

def valid_url(url):
    from urllib.parse import urlsplit
    u = urlsplit(url)
    if u.scheme != 'https' or u.hostname not in HOSTS or u.username or u.password or u.port not in (None, 443):
        raise ValueError('official_https_url_required')
    return url

class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        valid_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def download(url):
    opener = urllib.request.build_opener(OfficialRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    req = urllib.request.Request(valid_url(url), headers={'User-Agent': 'IndonesiaTaxKnowledgeResearch/1.0'})
    with opener.open(req, timeout=35) as response:
        valid_url(response.url)
        if int(response.headers.get('Content-Length', 0)) > MAX_BYTES:
            raise ValueError('download_size_limit')
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('download_size_limit')
        if not data.startswith(b'%PDF-'):
            raise ValueError('expected_pdf_not_html_or_error_page')
        return data, response.url

def extract(path):
    import pdfplumber
    pages = []
    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) > 750:
            raise ValueError('page_limit')
        for number, page in enumerate(pdf.pages, 1):
            text = page.extract_text(layout=False) or ''
            letters = sum(c.isalpha() for c in text)
            bad = text.count('\ufffd') + sum(ord(c) < 32 and c not in '\n\r\t' for c in text)
            status = 'candidate' if letters >= 40 and bad / max(len(text), 1) < .01 else 'unreliable'
            detected = page.find_tables()
            strategy = 'ruled_lines'
            if not detected and (len(re.findall(r'%|persen',text)) >= 4 or 'Tarif Pajak' in text):
                # Raster rules cannot be detected as PDF vectors; text columns are a candidate only.
                detected = page.find_tables({'vertical_strategy':'text','horizontal_strategy':'text',
                                             'min_words_vertical':2})
                strategy = 'text_columns_candidate'
            tables = [{'bbox': list(t.bbox), 'cells': t.extract(), 'strategy':strategy,
                       'status': 'needs_visual_review'} for t in detected]
            pages.append({'page': number, 'width': page.width, 'height': page.height,
                          'text': text, 'layout_text': page.extract_text(layout=True) or '',
                          'tables': tables, 'quality': status,
                          'issues': [] if status == 'candidate' else ['scan_or_poor_text_layer; OCR not trusted']})
    return {'extractor': 'pdfplumber', 'extractor_version': pdfplumber.__version__,
            'pipeline_version':2,'legal_status': 'unverified', 'pages': pages}

def ingest(registry, store, refresh=False):
    store.mkdir(parents=True, exist_ok=True)
    # Single writer. Lock also prevents lost history during simultaneous imports.
    lock = store / '.ingest.lock'
    handle = lock.open('x')
    try:
        manifest_path = store / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {'schema_version': 1, 'sources': {}}
        for source in registry['sources']:
            sid = source['id']
            if not re.fullmatch(r'[A-Z0-9_]+', sid):
                raise ValueError('invalid_source_id')
            record = manifest['sources'].setdefault(sid, {'versions': [], 'attempts': []})
            now = datetime.now(timezone.utc).isoformat()
            if record['versions'] and not refresh:
                continue
            try:
                data, resolved = download(source['download_url'])
                sha = digest(data)
                blob = store / 'blobs' / (sha + '.pdf')
                blob.parent.mkdir(exist_ok=True)
                if blob.exists() and digest(blob.read_bytes()) != sha:
                    raise ValueError('archive_integrity_failure')
                if not blob.exists():
                    blob.write_bytes(data)
                ext = store / 'extracted' / (sha + '.json')
                if not ext.exists():
                    write_json(ext, extract(blob))
                else:
                    json.loads(ext.read_text(encoding='utf-8'))
                version = next((v for v in record['versions'] if v['sha256'] == sha), None)
                if version is None:
                    version = {'sha256': sha, 'downloaded_at': now, 'resolved_url': resolved,
                               'original_url': source['download_url'], 'metadata': source,
                               'blob': 'blobs/' + sha + '.pdf', 'extraction': 'extracted/' + sha + '.json',
                               'verification_status': 'downloaded_unverified', 'checked_at': None,
                               'unresolved_issues': ['amendment_chain_and_extraction_require_review']}
                    record['versions'].append(version)
                record['current_sha256'] = sha
                record['attempts'].append({'at': now, 'status': 'downloaded', 'sha256': sha})
                print(sid, sha[:12], 'pages', len(json.loads(ext.read_text(encoding='utf-8'))['pages']))
            except Exception as e:
                record['attempts'].append({'at': now, 'status': 'failed', 'issue': type(e).__name__ + ': ' + str(e)[:250]})
                print(sid, 'FAILED', str(e)[:180])
            write_json(manifest_path, manifest)
        return manifest
    finally:
        handle.close()
        lock.unlink()

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--registry', required=True)
    p.add_argument('--store', required=True)
    p.add_argument('--refresh', action='store_true')
    args = p.parse_args()
    ingest(json.loads(Path(args.registry).read_text(encoding='utf-8')), Path(args.store), args.refresh)
