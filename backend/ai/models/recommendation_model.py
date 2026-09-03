"""VANTA AI - Recommendation Models"""\nimport logging,time,random,math\nfrom collections import defaultdict\nfrom typing import Any,Dict,List,Optional\nimport numpy as np\nfrom config import settings\nfrom services.cache_service import cache_service\n\nlogger=logging.getLogger("vanta.ai.models.recommendation")\n\n
class ContentBasedRecommender:
  def __init__(self):
    self.content_embeddings={}
    self.user_profiles={}
    logger.info("ContentBasedRecommender initialized")
  def add_content_embedding(self,content_id,embedding,metadata=None):
    self.content_embeddings[content_id]={"embedding":np.array(embedding),"metadata":metadata or {}}
  def add_user_profile(self,user_id,embedding):
    self.user_profiles[user_id]=np.array(embedding)
  def recommend(self,user_id,top_k=20,exclude=None):
    exclude=exclude or set()
    if user_id not in self.user_profiles or not self.content_embeddings: return []
    ue=self.user_profiles[user_id]
    scores=[]
    for cid,cd in self.content_embeddings.items():
      if cid in exclude: continue
      emb=cd["embedding"]
      nu=np.linalg.norm(ue); nc=np.linalg.norm(emb)
      if nu>0 and nc>0:
        sim=float(np.dot(ue,emb)/(nu*nc))
        scores.append((cid,sim))
    scores.sort(key=lambda x:-x[1])
    return [{"content_id":i,"score":float(s),"model":"content","reason":"Matches your interests"} for i,s in scores[:top_k]]

class HybridRecommender:
  def __init__(self):
    self.cf=CollaborativeFiltering()
    self.cb=ContentBasedRecommender()
    self.weight=settings.RECOMMENDATION_HYBRID_WEIGHT
    logger.info("HybridRecommender initialized")
  def recommend(self,user_id,top_k=20,exclude=None):
    exclude=exclude or set()
    cf=self.cf.recommend_user_based(user_id,top_k=top_k*2,exclude=exclude)
    cb=self.cb.recommend(user_id,top_k=top_k*2,exclude=exclude)
    scores=defaultdict(float)
    for r in cf: scores[r["content_id"]]+=self.weight*r["score"]
    for r in cb: scores[r["content_id"]]+=(1-self.weight)*r["score"]
    sorted_items=sorted(scores.items(),key=lambda x:-x[1])[:top_k]
    return [{"content_id":i,"score":float(s),"model":"hybrid","reason":"Personalized recommendation"} for i,s in sorted_items]

class TrendingScorer:
  def __init__(self):
    self.engagements={}
    self.decay_days=settings.TRENDING_DECAY_DAYS
    logger.info("TrendingScorer initialized")
  def record_engagement(self,content_id,engagement_type="view",timestamp=None):
    weights={"view":1,"like":3,"comment":5,"share":10,"save":4}
    self.engagements.setdefault(content_id,[]).append({"type":engagement_type,"weight":weights.get(engagement_type,1),"timestamp":timestamp or time.time()})
  def score(self,content_id,ct=None):
    ct=ct or time.time()
    decay_s=self.decay_days*86400
    if content_id not in self.engagements: return 0.0
    total=0.0
    for e in self.engagements[content_id]:
      age=ct-(e.get("timestamp") or ct)
      if age>decay_s: continue
      total+=e["weight"]*math.exp(-age/decay_s)
    return total
  def get_trending(self,top_k=20):
    scores=[(cid,self.score(cid)) for cid in self.engagements]
    scores.sort(key=lambda x:-x[1])
    return [{"content_id":cid,"trending_score":float(s),"velocity":float(s*0.1),"rank":r+1} for r,(cid,s) in enumerate(scores[:top_k])]

class PersonalizationEngine:
  def __init__(self):
    self.hybrid=HybridRecommender()
    self.trending=TrendingScorer()
    self.cf=CollaborativeFiltering()
    self.cb=ContentBasedRecommender()
    logger.info("PersonalizationEngine initialized")
  async def generate_feed(self,user_id,user_emb=None,page=1,page_size=50,exclude_ids=None):
    exclude=set(exclude_ids or [])
    if user_emb: self.cb.add_user_profile(user_id,user_emb)
    hybrid=self.hybrid.recommend(user_id,top_k=page_size*3,exclude=exclude)
    trending=self.trending.get_trending(top_k=page_size)
    seen=set(exclude)
    feed=[]; ri=0; ti=0
    while len(feed)<page_size*3 and (ri<len(hybrid) or ti<len(trending)):
      if ti<len(trending) and (ri>=len(hybrid) or random.random()<0.3):
        item=trending[ti]; ti+=1
        if item["content_id"] not in seen:
          feed.append({"content_id":item["content_id"],"score":item["trending_score"],"reason":"Trending now","model":"trending"})
          seen.add(item["content_id"])
      elif ri<len(hybrid):
        item=hybrid[ri]; ri+=1
        if item["content_id"] not in seen:
          feed.append(item); seen.add(item["content_id"])
    return feed[(page-1)*page_size:page*page_size]
  async def generate_discovery(self,user_id,page=1,page_size=30):
    t=self.trending.get_trending(top_k=page_size*5)
    start=(page-1)*page_size
    return [{"content_id":i["content_id"],"score":i["trending_score"]*0.8,"reason":"Discover new content","model":"discovery"} for i in t[start:start+page_size]]

collaborative_filtering=CollaborativeFiltering()
content_based_recommender=ContentBasedRecommender()
hybrid_recommender=HybridRecommender()
trending_scorer=TrendingScorer()
personalization_engine=PersonalizationEngine()
