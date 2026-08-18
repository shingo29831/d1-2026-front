import sys
import json
import base64
import time
import cv2
import numpy as np
from ultralytics import YOLO

try:
    model = YOLO('yolov8n-pose.pt')
except Exception as e:
    print(f'Model load error: {e}', file=sys.stderr)
    sys.exit(1)

for line in sys.stdin:
    try:
        if ',' in line:
            header, encoded = line.strip().split(',', 1)
        else:
            encoded = line.strip()
        img_bytes = base64.b64decode(encoded)
        img_arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_arr, flags=cv2.IMREAD_COLOR)
        if img is None:
            continue
            
        results = model(img, conf=0.15, imgsz=480, verbose=False)
        
        event_type = "normal"
        hazard_type = "none"
        x = 0
        y = 0
        confidence = 0.0
        keypoints_list = []

        if results and len(results) > 0:
            result = results[0]
            if result.keypoints is not None and len(result.keypoints.data) > 0:
                # 最初の人物のキーポイントを取得
                kpts_tensor = result.keypoints.data[0]
                keypoints_list = kpts_tensor.tolist()
                
            if result.boxes is not None and len(result.boxes) > 0:
                box = result.boxes[0]
                x_center = float((box.xyxy[0][0] + box.xyxy[0][2]) / 2)
                y_center = float((box.xyxy[0][1] + box.xyxy[0][3]) / 2)
                conf = float(box.conf[0])
                
                x = int(x_center)
                y = int(y_center)
                confidence = round(conf, 2)
                
                # 簡易的な転倒判定: バウンディングボックスの幅が高さより1.2倍以上大きい場合
                width = float(box.xyxy[0][2] - box.xyxy[0][0])
                height = float(box.xyxy[0][3] - box.xyxy[0][1])
                if height > 0 and width / height > 1.2:
                    event_type = "ai_hazard"
                    hazard_type = "fall"

        # 本番環境の共通JSONスキーマに完全に統一
        output = {
            "device_id": "mv_camera_01",
            "room_id": "living_room",
            "timestamp": int(time.time() * 1000),
            "event_type": event_type,
            "details": {
                "hazard_type": hazard_type,
                "x": x,
                "y": y,
                "confidence": confidence,
                "keypoints": keypoints_list
            }
        }
        
        print(json.dumps(output))
        sys.stdout.flush()
    except Exception as e:
        print(f'Processing error: {e}', file=sys.stderr)