import json,re,collections
d=json.load(open('acp_agents_top500.json'))
R=[
 ('BOOST', r'boost|mutual|growth|index_agent|referral|leaderboard|rank_agent'),
 ('CREATIVE', r'video|image|art|meme|music|drama|draw|song|avatar|logo|design|clip|story|voice|nft_gen|ascii'),
 ('ACTION', r'swap|trade|dca|bridge|deposit|withdraw|position|stake|redeem|transfer|fund|allocation|perp|mint|deploy|launch|buy|sell|claim|forge|battle|round|dice|roulette|bet|casino|signal|register'),
 ('COMPUTE', r'calculat|simulat|backtest|indicator|rsi|macd|bollinger|adx|atr|correlation|apy|breakeven|vesting|arb_profit|compound|convert|hash|encode|decode|score_lookup|calculate_score'),
 ('DATA', r'price|lookup|fetch|scrape|extract|feed|rss|whois|dns|certificate|status|weather|air_quality|metar|tvl|volume|mempool|yield\b|bond|commodity|cpi|financials|search|info|tags|stats|contributors|events|sportsdata|broadcast|snapshot|gas|balance|scanner|tx_|approval|mention|trending|arxiv|doi|book'),
 ('ANALYSIS', r'.'),
]
def cls_off(n):
  for c,p in R:
    if re.search(p,n,re.I): return c
OVR={'Ethy AI':'ACTION','Nox':'ANALYSIS','ArAIstotle':'ANALYSIS','Director Lucien':'CREATIVE','Otto AI - Market Alpha Agent':'ANALYSIS','Degen Claw':'ACTION','OOPZ Labs':'OTHER','Axelrod':'ACTION','Luna':'CREATIVE','WhaleIntel':'ANALYSIS','Seeker':'ANALYSIS','The TA Guru':'ANALYSIS','aixbt':'ANALYSIS','Otto AI - Trade Execution Agent':'ACTION','Remi':'ANALYSIS','Daredevil':'DATA','Loky':'ANALYSIS','Wasabot':'ACTION','ASCII Artist':'CREATIVE','Cybercentry':'ANALYSIS','Capminal':'ACTION','Binary Smith':'ACTION','BasisOS':'ACTION','Odds or Evens':'ACTION','EvalRank':'COMPUTE','Maya':'CREATIVE','Otto AI - Tools Agent':'CREATIVE','Gaffer':'ANALYSIS','Bravo Echo Tango':'ACTION','Hyperbet':'ACTION','truffle':'DATA','WachAI':'ANALYSIS','otter':'DATA','pretzel':'DATA','raccoon':'DATA','ferret':'DATA','tradewise':'COMPUTE','mochi':'DATA','macaw':'DATA','pelican':'DATA','frenchfry':'DATA','Growth Driven Protocol':'BOOST','waffle':'COMPUTE','MutualClaw':'BOOST','ShieldAI Security':'BOOST','x402guard':'ANALYSIS','MORSE':'ACTION','Captain Dackie':'ACTION','Synapse Robotics Network':'OTHER'}
rows=[]
for a in d:
  offs=[j.get('name','') for j in (a.get('jobs') or [])]+[o.get('name','') for o in (a.get('offerings') or []) if isinstance(o,dict)]
  if a['name'] in OVR: c=OVR[a['name']]
  elif offs:
    c=collections.Counter(cls_off(o) for o in offs).most_common(1)[0][0]
  else:
    c=cls_off((a.get('name') or '')+' '+(a.get('description') or '')[:200]) if a.get('description') else 'OTHER'
  rows.append((c,a.get('successfulJobCount') or 0,a.get('revenue') or 0,a.get('grossAgenticAmount') or 0,a['name'],offs[:5]))
def table(rs,label):
  J=sum(r[1] for r in rs); V=sum(r[2] for r in rs); G=sum(r[3] for r in rs)
  print('##',label,'agents',len(rs),'jobs',J,'revenue',round(V),'gross',round(G))
  for c in ['ACTION','DATA','COMPUTE','ANALYSIS','CREATIVE','BOOST','OTHER']:
    s=[r for r in rs if r[0]==c]
    print(f'{c:9} n={len(s):3} jobs={sum(r[1] for r in s)/J:6.1%} rev={sum(r[2] for r in s)/V:6.1%} gross={sum(r[3] for r in s)/G:6.1%}')
table(rows,'top500')
table([r for r in rows if r[4]!='Ethy AI'],'top500 sans Ethy')
json.dump(rows,open('acp_classified.json','w'),indent=0,ensure_ascii=False)
for c in ['DATA','COMPUTE']:
  print('--',c,[r[4] for r in rows if r[0]==c][:40])
