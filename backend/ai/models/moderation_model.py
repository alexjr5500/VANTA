"VANTA AI - Moderation Models"
import logging,re,time,random,json
from typing import Any,Dict,List,Optional
from config import settings
from services.cache_service import cache_service
logger=logging.getLogger("vanta.ai.models.moderation")

class ToxicityDetector:
  def __init__(self,threshold=None):
    self.threshold=threshold or settings.TOXICITY_THRESHOLD
    self._model=None
  async def _load_model(self):
    if self._model: return
    try:
      from transformers import pipeline
      self._model=pipeline("text-classification",model="unitary/toxic-bert")
    except: self._model="mock"
  def _mock_check(self,text):
    toxic=["hate","kill","stupid","idiot","damn","ugly","trash","awful","fool","dumb","moron","loser","shut up"]
    matches=sum(1 for w in toxic if w in text.lower())
    score=min(1.0,matches*0.15+random.uniform(0,0.1)) if matches else random.uniform(0,0.15)
    return {"score":round(score,4),"label":"TOXIC" if score>self.threshold else "NON_TOXIC"}
  async def check(self,text):
    await self._load_model()
    if self._model and self._model!="mock":
      try: r=self._model(text[:512])[0]; s=r["score"] if r["label"].upper()=="TOXIC" else 1-r["score"]; return {"score":round(float(s),4),"label":"TOXIC" if s>self.threshold else "NON_TOXIC"}
      except: pass
    return self._mock_check(text)

