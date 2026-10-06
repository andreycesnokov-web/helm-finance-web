import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('ingest',Path(__file__).resolve().parents[1]/'tools/indonesia_tax_kb/ingest.py')
ingest=importlib.util.module_from_spec(spec);spec.loader.exec_module(ingest)

class IngestionTests(unittest.TestCase):
    def test_official_url_validation(self):
        for url in ['http://pajak.go.id/x','https://pajak.go.id.evil.test/x','https://localhost/x','https://user@pajak.go.id/x','https://pajak.go.id:8443/x']:
            with self.assertRaises(ValueError):ingest.valid_url(url)
        self.assertEqual(ingest.valid_url('https://jdih.kemenkeu.go.id/x'),'https://jdih.kemenkeu.go.id/x')

    def test_redirect_validation(self):
        with self.assertRaises(ValueError):
            ingest.OfficialRedirect().redirect_request(None,None,302,'',{},'https://evil.test/x')

    def test_idempotence_versions_and_unchanged_refresh(self):
        source={'id':'S1','download_url':'https://pajak.go.id/a.pdf'}
        with tempfile.TemporaryDirectory() as tmp, patch.object(ingest,'extract',return_value={'pages':[]}):
            store=Path(tmp)
            with patch.object(ingest,'download',return_value=(b'%PDF-test-v1',source['download_url'])) as download:
                first=ingest.ingest({'sources':[source]},store)
                again=ingest.ingest({'sources':[source]},store)
                self.assertEqual(download.call_count,1)
                self.assertEqual(first,again)
                refreshed=ingest.ingest({'sources':[source]},store,True)
                self.assertEqual(len(refreshed['sources']['S1']['versions']),1)
            with patch.object(ingest,'download',return_value=(b'%PDF-test-v2',source['download_url'])):
                changed=ingest.ingest({'sources':[source]},store,True)
                self.assertEqual(len(changed['sources']['S1']['versions']),2)
                self.assertEqual(len(list((store/'blobs').glob('*.pdf'))),2)
                self.assertTrue(all(v['checked_at'] is None for v in changed['sources']['S1']['versions']))

    def test_failed_refresh_preserves_previous_version(self):
        source={'id':'S1','download_url':'https://pajak.go.id/a.pdf'}
        with tempfile.TemporaryDirectory() as tmp, patch.object(ingest,'extract',return_value={'pages':[]}):
            with patch.object(ingest,'download',return_value=(b'%PDF-test',source['download_url'])):
                before=ingest.ingest({'sources':[source]},Path(tmp))
            with patch.object(ingest,'download',side_effect=TimeoutError('test')):
                after=ingest.ingest({'sources':[source]},Path(tmp),True)
            self.assertEqual(before['sources']['S1']['current_sha256'],after['sources']['S1']['current_sha256'])
            self.assertEqual(after['sources']['S1']['attempts'][-1]['status'],'failed')

    def test_single_writer_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp)/'.ingest.lock').write_text('locked')
            with self.assertRaises(FileExistsError):ingest.ingest({'sources':[]},Path(tmp))

    def test_scan_without_text_is_unreliable(self):
        from pypdf import PdfWriter
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'blank.pdf';writer=PdfWriter();writer.add_blank_page(width=612,height=792)
            with file.open('wb') as stream:writer.write(stream)
            result=ingest.extract(file)
            self.assertEqual(result['pages'][0]['quality'],'unreliable')
            self.assertTrue(result['pages'][0]['issues'])

    def test_TER_table_candidate_retains_cells_and_review_status(self):
        kb=Path(__file__).resolve().parents[1]/'knowledge/indonesia_tax_kb'
        manifest=json.loads((kb/'store/manifest.json').read_text(encoding='utf-8'))
        version=manifest['sources']['PP58_2023']['versions'][-1]
        result=json.loads((kb/'store'/version['extraction']).read_text(encoding='utf-8'))
        self.assertTrue(result['pages'][10]['tables'])
        table=result['pages'][10]['tables'][0]
        self.assertEqual(table['status'],'needs_visual_review')
        self.assertTrue(table['cells']);self.assertEqual(len(table['bbox']),4)

    def test_PMK1_instruction_map_matches_exact_archived_text(self):
        kb=Path(__file__).resolve().parents[1]/'knowledge/indonesia_tax_kb'
        data=json.loads((kb/'amendments/PMK1_2026.json').read_text(encoding='utf-8'))
        extraction=json.loads((kb/'store/extracted'/(data['source_sha256']+'.json')).read_text(encoding='utf-8'))
        self.assertEqual(len(data['changes']),8)
        for change in data['changes']:
            page=next(p for p in extraction['pages'] if p['page']==change['page'])
            self.assertEqual(page['text'][change['start']:change['end']],change['official_text'])
            self.assertFalse(change['currency_confirmed'])
        self.assertEqual(data['consolidation_review'],'pending')

if __name__=='__main__':unittest.main()
