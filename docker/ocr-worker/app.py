"""
CFO AI - Open-Source OCR Worker Service
Powered by RapidOCR / PaddleOCR PP-OCRv4 ONNX Engine
Zero auto-posting: this worker provides pure character recognition for human review.
"""

import io
import time
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
from PIL import Image
import pypdfium2 as pdfium
from rapidocr_onnxruntime import RapidOCR

app = FastAPI(
    title="CFO AI OCR Worker",
    description="Isolated microservice for high-speed document OCR using PaddleOCR PP-OCR ONNX models.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize global OCR engine once at worker startup
print("Initializing RapidOCR (PP-OCRv4 ONNX engine)...")
ocr_engine = RapidOCR()
print("RapidOCR engine initialized successfully.")


class OCRLine(BaseModel):
    text: str
    confidence: float
    box: List[List[float]]


class OCRPageResult(BaseModel):
    page_number: int
    text: str
    line_count: int
    avg_confidence: float
    duration_ms: float
    lines: List[OCRLine]


class OCRResponse(BaseModel):
    status: str
    filename: str
    content_type: str
    total_pages: int
    total_duration_ms: float
    full_text: str
    pages: List[OCRPageResult]
    metadata: dict


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "cfo-ocr-worker",
        "engine": "PaddleOCR PP-OCRv4 (ONNX Runtime)",
        "license": "Apache-2.0",
        "timestamp": time.time()
    }


def process_image_np(img_np: np.ndarray, page_num: int = 1) -> OCRPageResult:
    start_time = time.perf_counter()
    result, elapse_time = ocr_engine(img_np)
    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

    lines: List[OCRLine] = []
    text_parts: List[str] = []
    confidences: List[float] = []

    if result:
        for item in result:
            box = item[0]
            text = str(item[1]).strip()
            score = float(item[2])
            if text:
                lines.append(OCRLine(
                    text=text,
                    confidence=round(score, 4),
                    box=[[round(float(coord), 1) for coord in pt] for pt in box]
                ))
                text_parts.append(text)
                confidences.append(score)

    full_page_text = "\n".join(text_parts)
    avg_conf = round(sum(confidences) / len(confidences), 4) if confidences else 0.0

    return OCRPageResult(
        page_number=page_num,
        text=full_page_text,
        line_count=len(lines),
        avg_confidence=avg_conf,
        duration_ms=duration_ms,
        lines=lines
    )


@app.post("/ocr/predict", response_model=OCRResponse)
async def predict_ocr(
    file: UploadFile = File(...),
    dpi: int = Query(200, ge=72, le=300, description="DPI for PDF rendering (default 200)")
):
    start_total = time.perf_counter()
    filename = file.filename or "unknown_document"
    contents = await file.read()

    if not contents:
        raise HTTPException(status_code=400, detail="Empty document payload.")

    is_pdf = filename.lower().endswith(".pdf") or file.content_type == "application/pdf"
    pages_results: List[OCRPageResult] = []

    try:
        if is_pdf:
            # Render PDF pages with pypdfium2
            pdf = pdfium.PdfDocument(contents)
            total_pages = len(pdf)
            scale = dpi / 72.0

            for page_idx in range(total_pages):
                page = pdf[page_idx]
                image = page.render(scale=scale).to_pil()
                img_np = np.array(image)
                # Convert RGBA to RGB if needed
                if img_np.ndim == 3 and img_np.shape[2] == 4:
                    img_np = img_np[:, :, :3]

                page_res = process_image_np(img_np, page_num=page_idx + 1)
                pages_results.append(page_res)
        else:
            # Process standard raster image
            image = Image.open(io.BytesIO(contents))
            if image.mode != "RGB":
                image = image.convert("RGB")
            img_np = np.array(image)
            page_res = process_image_np(img_np, page_num=1)
            pages_results.append(page_res)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR processing error: {str(e)}")

    total_duration_ms = round((time.perf_counter() - start_total) * 1000, 2)
    combined_text = "\n\n--- PAGE BREAK ---\n\n".join(p.text for p in pages_results) if len(pages_results) > 1 else (pages_results[0].text if pages_results else "")

    return OCRResponse(
        status="success",
        filename=filename,
        content_type=file.content_type or ("application/pdf" if is_pdf else "image/png"),
        total_pages=len(pages_results),
        total_duration_ms=total_duration_ms,
        full_text=combined_text,
        pages=pages_results,
        metadata={
            "worker_version": "1.0.0",
            "model_architecture": "PP-OCRv4 (Detection + Direction Classification + Recognition)",
            "dpi": dpi if is_pdf else None,
            "accounting_guardrail": "Zero auto-posting guaranteed. Output requires accountant confirmation."
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
