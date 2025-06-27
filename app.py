# app.py (Updated for CPU)

import os
import warnings
import requests
from PIL import Image
from io import BytesIO
from contextlib import asynccontextmanager

import torch
from transformers import AutoModelForImageTextToText, AutoProcessor

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader

# --- 0. Setup ---
warnings.filterwarnings("ignore", category=UserWarning, message="Overriding torch_dtype=None")
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

# --- 1. Load Model and Processor (on startup) ---
# MODEL_ID = "sunbv56/qwen2.5-vl-vqa-vibook"

# If there is an error loading the model, switch to this to use the local version.
MODEL_ID = "./local-model/qwen2.5-vl-vqa-vibook"

print(f"🚀 Đang tải model '{MODEL_ID}' và processor để chạy trên CPU...")

model = None
processor = None

try:
    # For CPU, we use float32 and explicitly set device_map to "cpu"
    dtype = torch.float16
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL_ID,
        torch_dtype=dtype,
        device_map="cpu",
        trust_remote_code=True
    )
    processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True, use_fast=True)
    model.eval()
    # The model.device attribute will now correctly be 'cpu'
    print(f"✅ Model và processor đã được tải thành công trên thiết bị: {model.device.type}!")
except Exception as e:
    print(f"❌ Lỗi khi tải model/processor: {e}")
    # We don't exit here, so the app can still run and show an error.

# --- 2. Core VQA Inference Function ---
def process_vqa(image: Image.Image, question: str):
    """
    Takes a PIL Image and a question, returns the model's answer.
    """
    if not model or not processor:
        raise RuntimeError("Model and/or processor are not loaded. Cannot perform inference.")
        
    if image.mode != "RGB":
        image = image.convert("RGB")

    messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": question}]}]
    prompt_text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    
    # This line works for both CPU and GPU, as it uses the model's loaded device.
    model_inputs = processor(text=[prompt_text], images=[image], return_tensors="pt").to(model.device)
    
    generated_ids = model.generate(
        **model_inputs,
        max_new_tokens=128,
        do_sample=False,
        temperature=1.0, 
        eos_token_id=processor.tokenizer.eos_token_id,
        pad_token_id=processor.tokenizer.pad_token_id
    )
    
    generated_ids = generated_ids[:, model_inputs['input_ids'].shape[1]:]
    response = processor.tokenizer.decode(generated_ids[0], skip_special_tokens=True).strip()
    return response

# --- 4. Startup Asset Downloader ---
async def download_assets():
    """
    On server startup, check for and download example assets.
    """
    ASSETS_DIR = "assets"
    if not os.path.exists(ASSETS_DIR):
        os.makedirs(ASSETS_DIR)
        print("Đã tạo thư mục 'assets' cho các hình ảnh ví dụ.")
    
    EXAMPLE_FILES = {
        "book_example_1.jpg": "https://cdn0.fahasa.com/media/catalog/product/d/i/dieu-ky-dieu-cua-tiem-tap-hoa-namiya---tai-ban-2020.jpg",
        "book_example_2.jpg": "https://cdn0.fahasa.com/media/catalog/product/d/r/dr.-stone_bia_tap-26.jpg"
    }

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
    for filename, url in EXAMPLE_FILES.items():
        filepath = os.path.join(ASSETS_DIR, filename)
        if not os.path.exists(filepath):
            print(f"Đang tải xuống hình ảnh ví dụ: {filename}...")
            try:
                response = requests.get(url, headers=headers, timeout=20)
                response.raise_for_status() 
                with open(filepath, 'wb') as f:
                    f.write(response.content)
                print("...Đã xong.")
            except requests.exceptions.RequestException as e:
                print(f"❌ Lỗi khi tải {filename}: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Code to run on startup
    print("🚀 Running startup tasks...")
    await download_assets()
    print("✅ Startup tasks complete.")
    yield
    # Code to run on shutdown (nếu có)
    print("⚡ Server is shutting down.")

# --- 3. FastAPI Application ---
app = FastAPI(title="Vibook VQA Chatbot API", lifespan=lifespan)

# Mount static directories to serve JS, CSS, and images
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/assets", StaticFiles(directory="assets"), name="assets")

# Setup Jinja2 for HTML templating
env = Environment(loader=FileSystemLoader('templates'))

@app.get("/", response_class=HTMLResponse)
async def read_root():
    """Serve the main HTML page."""
    template = env.get_template('index.html')
    return HTMLResponse(template.render())

@app.post("/vqa")
async def handle_vqa(question: str = Form(...), image: UploadFile = File(...)):
    """
    API endpoint to handle a VQA request.
    Receives an image and a question, returns a JSON response with the answer.
    """
    if not model or not processor:
        raise HTTPException(status_code=503, detail="Model is not available. Please check server logs.")

    try:
        # Read image from upload
        contents = await image.read()
        pil_image = Image.open(BytesIO(contents))
        
        # Get answer from the model
        answer = process_vqa(pil_image, question)
        
        return JSONResponse(content={"question": question, "answer": answer})
    except Exception as e:
        print(f"Error during VQA processing: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- To run the app ---
if __name__ == "__main__":
    import uvicorn
    import socket
    # Make sure to create the directories if they don't exist before starting
    if not os.path.exists("static"): os.makedirs("static")
    if not os.path.exists("templates"): os.makedirs("templates")

    # Lấy IP cục bộ
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Kết nối tới IP bất kỳ để lấy IP của máy (mặc dù không thực sự gửi đi)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = "127.0.0.1"
    finally:
        s.close()
    
    port = 8000
    print(f"🚀 Server starting at http://{local_ip}:{port}")

    # Dùng 0.0.0.0 để cho phép truy cập từ thiết bị khác trong mạng LAN
    uvicorn.run(app, host="0.0.0.0", port=port)