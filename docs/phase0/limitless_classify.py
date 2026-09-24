import json,re,collections
d=json.load(open('active.json'))
# A = objective, structured official/data source (score, stat release, price, rate decision, election count)
# B = objective event but sourced from announcements/news (launch, acquisition, retirement, "out by", law signed)
# C = subjective / ambiguous / hard to source ("what will X say", "effectively closed", invasion, regime fall)
rules=[
 ('C',r'say during|effectively closed|invade|regime fall|clash|aliens|control by|blockade|traffic returns|resume|public appearance|election emergency|Hormuz fees|peace talks|meet next|Greenland|layoffs|Knighted|new case or terminal|Power Rankings|analyst at|Top ActBlue|enters Venezuela|leader end'),
 ('A',r' vs\.? |to defeat|Champion|Winner|Top Goalscorer|Golden Boot|Relegation|Top 4|Top 3|Grand Prix|Promotion|appearances|win at least|Decision|decision|Interest Rates|Inflation|PPI|PCE|PMI|GDP|exports|rate cut|rate hike|recession|Treasury|hit|price|all time high|FDV|Market Cap|valuation|reserves fall|Election|Nominee|Senate|House|Balance of Power|Margin|approval rating|Index|beat quarterly|Semi Trucks|Starship|satellites|stablecoins hit|MVP|Ballon|Majority Leader|Prime Minister|Presidential|STRC|ground beef|Opening Match|nominee'),
 ('B',r'.'),
]
def cls(t):
  for c,p in rules:
    if re.search(p,t): return c
rows=[]
for x in d:
  if x['automationType']!='manual': continue
  m=x.get('metadata') or {}
  rows.append((cls(x['title']),bool(m.get('isPolyArbitrage')),float(x.get('volumeFormatted') or 0),x['title'],(x.get('categories') or ['-'])[0]))
c=collections.Counter(); v=collections.Counter()
for r in rows: c[r[0]]+=1; v[r[0]]+=r[2]; c[(r[0],'poly' if r[1] else 'native')]+=1
tot=sum(v.values())
print(len(rows)); 
for k in 'ABC': print(k,c[k],round(v[k]),f'{v[k]/tot:.0%}','poly',c[(k,'poly')],'native',c[(k,'native')])
for k in 'BC':
  print('---',k); [print(' ',r[3]) for r in rows if r[0]==k]
json.dump(rows,open('manual_classified.json','w'),indent=0)
