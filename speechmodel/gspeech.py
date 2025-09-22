import torch
import torch.nn.functional as F
import soundfile as sf
import torchaudio.transforms as T
from transformers import AutoConfig, Wav2Vec2Processor
from Wav2Vec2ForSpeechClassification import Wav2Vec2ForSpeechClassification
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

MY_MODEL = "padmalcom/wav2vec2-large-nonverbalvocalization-classification"
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
config = AutoConfig.from_pretrained(MY_MODEL)
processor = Wav2Vec2Processor.from_pretrained(MY_MODEL)
sampling_rate = processor.feature_extractor.sampling_rate
model = Wav2Vec2ForSpeechClassification.from_pretrained(MY_MODEL).to(device)

def speech_file_to_array_fn(path, sampling_rate):
    speech, sr = sf.read(path)
    speech = torch.tensor(speech).float()
    if sr != sampling_rate:
        resampler = T.Resample(sr, sampling_rate)
        speech = resampler(speech)
    if len(speech.shape) == 2:
        speech = speech.mean(dim=0)
    return speech.numpy()

def predict(path, sampling_rate):
    speech = speech_file_to_array_fn(path, sampling_rate)
    features = processor(speech, sampling_rate=sampling_rate, return_tensors="pt", padding=True)
    input_values = features.input_values.to(device)
    attention_mask = features.attention_mask.to(device)
    with torch.no_grad():
        logits = model(input_values, attention_mask=attention_mask).logits
    scores = F.softmax(logits, dim=1).detach().cpu().numpy()[0]
    outputs = [{"Vocalization": config.id2label[i], "Score": scores[i]} for i in range(len(scores))]
    return outputs

CONFIDENCE_THRESHOLD = 0.7

res = predict("scream.wav", sampling_rate)
top_label = max(res, key=lambda x: x['Score'])

print(f"Detected Vocalization: {top_label['Vocalization']} (Confidence: {top_label['Score']:.2f})")

if top_label["Vocalization"].lower() == "screaming" and top_label["Score"] > CONFIDENCE_THRESHOLD:
    print("environment unsafe")
else:
    print("environment safe")


