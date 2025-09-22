#!/usr/bin/env python3
import os
import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import argparse
import joblib
from torchvision.models.video import r3d_18, R3D_18_Weights

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

mean = np.array([0.43216, 0.394666, 0.37645])
std = np.array([0.22803, 0.22145, 0.216989])


class EmbeddingClassifier(nn.Module):
    def __init__(self, input_dim=512, num_classes=2):
        super().__init__()
        self.fc = nn.Linear(input_dim, num_classes)

    def forward(self, x):
        if x.dim() == 3:
            b, s, d = x.shape
            x_flat = x.view(b * s, d)
            out = self.fc(x_flat)
            return out.view(b, s, -1)
        else:
            return self.fc(x)


class LSTMAutoEncoder(nn.Module):
    def __init__(self, input_dim, hidden_dim=128):
        super().__init__()
        self.encoder = nn.LSTM(input_dim, hidden_dim, batch_first=True)
        self.decoder = nn.LSTM(hidden_dim, input_dim, batch_first=True)
        self.hidden_dim = hidden_dim

    def forward(self, x):
        _, (h, _) = self.encoder(x)
        z = h[-1].unsqueeze(1).repeat(1, x.size(1), 1)
        decoded, _ = self.decoder(z)
        return decoded


def get_r3d_model(pretrained=True):
    try:
        if pretrained:
            r3d = r3d_18(weights=R3D_18_Weights.DEFAULT)
        else:
            r3d = r3d_18(weights=None)
    except Exception as e:
        print("Warning: could not load R3D pretrained weights. Using uninitialized model.")
        r3d = r3d_18(weights=None)
    r3d.fc = nn.Identity()
    r3d = r3d.eval().to(device).float()
    return r3d


def video_to_embeddings(video_path, model, mean, std, clip_len=16, stride=8, size=112):
    if not os.path.isfile(video_path):
        print(f"video_to_embeddings: file not found: {video_path}")
        return None

    cap = cv2.VideoCapture(video_path)
    frames = []
    embeddings = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame = cv2.resize(frame, (size, size))
        frame = frame.astype(np.float32) / 255.0
        frame = (frame - mean) / std
        frames.append(frame)
    cap.release()

    if len(frames) < clip_len:
        print(f"Warning: Not enough frames in {video_path} ({len(frames)} < {clip_len})")
        return None

    model.eval()
    with torch.no_grad():
        for start in range(0, len(frames) - clip_len + 1, stride):
            clip = np.stack(frames[start:start + clip_len], axis=0)
            clip_t = torch.tensor(clip, dtype=torch.float32).permute(3, 0, 1, 2).unsqueeze(0).to(device)
            feats = model.stem(clip_t)
            feats = model.layer1(feats)
            feats = model.layer2(feats)
            feats = model.layer3(feats)
            feats = model.layer4(feats)
            emb = feats.mean(dim=[-3, -2, -1]).squeeze(0).cpu().numpy()
            embeddings.append(emb)

    return np.stack(embeddings) if embeddings else None


def fusion_decision(r3d_logits, ae_x, ae_xhat,
                    anomaly_threshold=0.7, crime_conf_threshold=0.75, normal_conf_threshold=0.8):
    logits_tensor = torch.tensor(r3d_logits).to(device)
    probs = torch.softmax(logits_tensor, dim=1)
    if probs.dim() == 2:
        crime_conf = probs[:, 1].max().item()
        normal_conf = probs[:, 0].max().item()
    else:
        crime_conf = float(probs[1])
        normal_conf = float(probs[0])

    ae_x = torch.tensor(ae_x, dtype=torch.float32).to(device)
    ae_xhat = torch.tensor(ae_xhat, dtype=torch.float32).to(device)
    mse = torch.mean((ae_x - ae_xhat) ** 2, dim=1)
    anomaly_score = mse.mean().item()

    print(f"  Classifier Conf (Crime): {crime_conf:.2f}")
    print(f"  Classifier Conf (No Crime): {normal_conf:.2f}")
    print(f"  Anomaly Score: {anomaly_score:.2f}")

    if crime_conf > crime_conf_threshold:
        return "crime", crime_conf, anomaly_score
    elif normal_conf > normal_conf_threshold:
        return "no crime", normal_conf, anomaly_score
    elif anomaly_score > anomaly_threshold:
        return "crime", crime_conf, anomaly_score
    else:
        return "no crime", normal_conf, anomaly_score


def analyze_video(video_path, r3d, lstmae, embedding_classifier):
    emb_seq = video_to_embeddings(video_path, r3d, mean, std)
    if emb_seq is None:
        print("No clips found.")
        return None

    emb_seq_torch = torch.tensor(emb_seq, dtype=torch.float32).unsqueeze(0).to(device)

    with torch.no_grad():
        xhat = lstmae(emb_seq_torch).cpu().squeeze(0).numpy()

    with torch.no_grad():
        clip_embeddings = torch.tensor(emb_seq, dtype=torch.float32).to(device)
        logits = embedding_classifier(clip_embeddings)
        avg_logits = torch.mean(logits, dim=0).unsqueeze(0).cpu().numpy()

    label, r3d_conf, anom = fusion_decision(avg_logits, emb_seq, xhat)
    print(f"RESULT: {label.upper()} (Classifier conf={r3d_conf:.2f}, Anomaly score={anom:.2f})")
    return label


def save_models(filename, embedding_classifier, lstmae):
    joblib.dump({
        'embedding_classifier': embedding_classifier,
        'lstmae': lstmae
    }, filename)
    print(f"Models saved to {filename}")


def load_models(filename):
    if not os.path.isfile(filename):
        raise FileNotFoundError(f"Model file not found: {filename}")
    model_bundle = joblib.load(filename)
    embedding_classifier = model_bundle['embedding_classifier'].to(device).eval()
    lstmae = model_bundle['lstmae'].to(device).eval()
    print(f"Models loaded from {filename}")
    return embedding_classifier, lstmae


def main(train=False, model_file='model.joblib', pretrained_r3d=True):
    r3d = get_r3d_model(pretrained=pretrained_r3d)

    embedding_classifier = EmbeddingClassifier(input_dim=512, num_classes=2).to(device)
    lstmae = LSTMAutoEncoder(input_dim=512, hidden_dim=128).to(device)

    if train:
        print("[TRAINING PLACEHOLDER] Replace with real training code")
        save_models(model_file, embedding_classifier, lstmae)
        print("Training finished and models saved.")
    else:
        if not os.path.exists(model_file):
            print(f"Model file '{model_file}' not found. Run with --train to create it first.")
            return
        embedding_classifier, lstmae = load_models(model_file)

        video_path = input("Enter path to video file: ").strip()
        if not os.path.isfile(video_path):
            print(f"File {video_path} does not exist.")
            return

        label = analyze_video(video_path, r3d, lstmae, embedding_classifier)
        if label:
            print(f"\nFinal Prediction for video: {label.upper()}")
        else:
            print("Failed to analyze video.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Crime detection script")
    parser.add_argument("--train", action="store_true", help="Train models (otherwise inference)")
    parser.add_argument("--model", default="model.joblib", help="Model bundle filename")
    parser.add_argument("--no-pretrained-r3d", action="store_true", help="Do not use pretrained R3D weights")
    args = parser.parse_args()

    main(train=args.train, model_file=args.model, pretrained_r3d=(not args.no_pretrained_r3d))
