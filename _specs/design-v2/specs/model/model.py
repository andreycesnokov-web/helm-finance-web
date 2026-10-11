import json
START=122.9; SALES=1.38; COSTS=1.40
EV=[(3,-24.0,'Payroll'),(4,-6.66,'Rent'),(6,17.5,'Bali Resort'),(8,-9.8,'Para Legals'),(13,-1.48,'Taxes'),(13,-1.2,'BPJS TK'),
    (14,48.2,'Sinar'),(18,-15.6,'Kimia'),(21,12.5,'Mitra'),(23,-36.0,'Location fees'),(28,-0.2,'Interest')]
def run(events,sales=SALES,costs=COSTS,days=30):
    pts=[(0,START)];v=START;last=0;after={}
    for d,a,n in sorted(events,key=lambda e:e[0]):
        v+=(sales-costs)*(d-last); pts.append((d,v)); v+=a; pts.append((d,v)); after[n]=v; last=d
    v+=(sales-costs)*(days-last); pts.append((days,v)); return pts,after
exp,after=run(EV)
worst_ev=[e for e in EV if e[2] not in ('Sinar','Mitra')]+[(28,48.2,'Sinar')]
worst,_=run(worst_ev,costs=COSTS*1.05)
best_ev=[e for e in EV if e[2]!='Mitra']+[(1,12.5,'Mitra')]
best,_=run(best_ev,sales=SALES*1.10)
pl_ev=[e for e in EV if e[2]!='Para Legals']+[(15,-9.8,'Para Legals')]
pl,_=run(pl_ev)
def low(p): m=min(p,key=lambda x:x[1]); return round(m[1],1),m[0]
r={'exp_end':round(exp[-1][1],1),'exp_low':low(exp),'worst_low':low(worst),'worst_end':round(worst[-1][1],1),'best_end':round(best[-1][1],1),
   'pl_low':low(pl),'after':{k:round(v,1) for k,v in after.items()},
   'cash_9oct':round(START+(SALES-COSTS)*7-24-6.66+17.5,2),'in7':round(17.5+SALES*7,1),'out7':round(24.0+6.66+COSTS*7,2)}
print(json.dumps(r,indent=0))
json.dump({'exp':exp,'worst':worst,'best':best},open('/tmp/claude-0/-home-claude-helm-finance-web/20314e75-83f8-581e-bf71-461acb831e72/scratchpad/model/series.json','w'))
