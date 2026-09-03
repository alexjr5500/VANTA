"""VANTA AI - Embedding Models"""
import logging,time
from typing import Any,Dict,List,Optional,Union
import numpy as np
from config import settings
from services.cache_service import cache_service
logger=logging.getLogger("vanta.ai.models.embedding")

class BaseEmbeddingModel:
    def __init__(self,model_name=None,dimension=384):
        self.model_name=model_name or settings.EMBEDDING_MODEL_NAME
        self.dimension=dimension; self._model=None

    async def _load_model(self):
        if self._model is not None: return
        try:
            from sentence_transformers import SentenceTransformer
            self._model=SentenceTransformer(self.model_name)
            self.dimension=self._model.get_sentence_embedding_dimension()
        except Exception as e:
            logger.warning(f"Model load failed: {e}, mock mode")
            self._model="mock"

    def _mock_emb(self,text):
        import hashlib
        seed=int(hashlib.md5(text.encode()).hexdigest()[:8],16)
        rng=np.random.RandomState(seed)
        vec=rng.randn(self.dimension).astype(np.float32)
        return (vec/np.linalg.norm(vec)).tolist()

    async def encode(self,texts):
        if isinstance(texts,str): texts=[texts]
        await self._load_model()
        if self._model and self._model!="mock":
            try: return self._model.encode(texts,show_progress_bar=False).tolist()
            except: pass
        return [self._mock_emb(t) for t in texts]

    async def encode_single(self,text):
        r=await self.encode([text]); return r[0] if r else []

    async def compute_similarity(self,a,b,metric="cosine"):
        a=np.array(a); b=np.array(b)
        if metric=="cosine":
            na=np.linalg.norm(a); nb=np.linalg.norm(b)
            return float(np.dot(a,b)/(na*nb)) if na>0 and nb>0 else 0.0
        elif metric=="euclidean": return 1.0/(1.0+float(np.linalg.norm(a-b)))
        else: return float(np.dot(a,b))

    async def search(self,q,c,top_k=10):
        if not c: return []
        q=np.array(q); c=np.array(c)
        qn=np.linalg.norm(q)
        cn=np.linalg.norm(c,axis=1)
        valid=cn>0; scores=np.zeros(len(c))
        if qn>0: scores[valid]=(c[valid]@q)/(cn[valid]*qn)
        idx=np.argsort(scores)[::-1][:top_k]
        return [(int(i),float(scores[i])) for i in idx]

class UserEmbeddingGenerator(BaseEmbeddingModel):
    def __init__(self):
        super().__init__(model_name=settings.EMBEDDING_MODEL_NAME,dimension=settings.USER_EMBEDDING_DIM)
    async def generate(self,user_id,profile_text,attributes=None):
        ck=f"embedding:user:{user_id}"
        cached=await cache_service.get(ck)
        if cached: return cached
        start=time.time()
        enriched=profile_text
        if attributes:
            attr_str=" ".join(f"{k}={v}" for k,v in attributes.items() if isinstance(v,str))
            enriched=f"{profile_text} {attr_str}"
        emb=await self.encode_single(enriched)
        result={"user_id":user_id,"embedding":emb,"dimension":self.dimension,"model":self.model_name,"processing_time_ms":round((time.time()-start)*1000,2)}
        await cache_service.set(ck,result,ttl=settings.REDIS_TTL_SECONDS)
        return result

class ContentEmbeddingGenerator(BaseEmbeddingModel):
    def __init__(self):
        super().__init__(model_name=settings.EMBEDDING_MODEL_NAME,dimension=settings.CONTENT_EMBEDDING_DIM)
    async def generate(self,content_id,content_type,text_content=None,description=None,tags=None,metadata=None):
        ck=f"embedding:content:{content_id}"
        cached=await cache_service.get(ck)
        if cached: return cached
        start=time.time()
        parts=[]
        if text_content: parts.append(text_content)
        if description: parts.append(description)
        if tags: parts.append(" ".join(tags))
        if metadata: parts.append(str(metadata))
        text=" ".join(parts) if parts else content_type
        emb=await self.encode_single(text)
        result={"content_id":content_id,"content_type":content_type,"embedding":emb,"dimension":self.dimension,"model":self.model_name,"processing_time_ms":round((time.time()-start)*1000,2)}
        await cache_service.set(ck,result,ttl=settings.REDIS_TTL_SECONDS)
        return result
    async def generate_batch(self,items):
        return [await self.generate(**i) for i in items]

user_embedding_generator=UserEmbeddingGenerator()
content_embedding_generator=ContentEmbeddingGenerator()
