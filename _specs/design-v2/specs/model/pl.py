import json
M=['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep']
R=[44,45,50,48,50,53,58,63,67,80,86,107]
loc=[20]*6+[30,36,36,36,36,36]
chem=[round(0.146*r,1) for r in R]; chem[-1]=15.6
fees=[round(0.0075*r,1) for r in R]; fees[-1]=0.8
rep=[0]*11+[26.5]
people=[12.5,12.5,12.5,13.5,13.5,13.5,20,23,25,27,27.5,27.84]
rent=[7.4]*12
legal=[3.0]*11+[10.0]
mkt=[2.0]*6+[3.0]*5+[4.5]
util=[1.8]*6+[2.0]*5+[2.1]
other=[9,9,9,9.5,9.5,10,22,26,30,38,40,42]
DA=[426.4/48]*6+[(426.4+78)/48]*6
interest=[0]*9+[0.2]*3
capex=[0]*6+[-78.0]+[0]*5
fin=[0,25,0,0,30,0,0,0,110,30,0,0]   # Jun: +120 equity -10 founder repay; Jul +30 intercompany
AR=[29, 30,31,34,33,34,36,30,33,31,34.2,49.9,78.2]  # index0 = 30 Sep 2025
AP=[20]+[None]*12
rows=[]
for i in range(12):
    direct=loc[i]+chem[i]+fees[i]+rep[i]; opex=people[i]+rent[i]+legal[i]+mkt[i]+util[i]+other[i]
    gp=R[i]-direct; ebitda=gp-opex; net=ebitda-DA[i]-interest[i]
    rows.append(dict(m=M[i],rev=R[i],direct=direct,gp=gp,gm=gp/R[i],opex=opex,ebitda=ebitda,da=DA[i],int=interest[i],net=net))
# OCF targets for Jul, Aug, Sep; earlier months AP chosen
APset={1:20,2:21,3:21,4:21,5:22,6:22,7:23,8:24,9:39}
target={10:-57.6,11:-59.2,12:-75.2}
# AP index k = end of month k (k=1..12). Solve backwards for 10,11 from 12=61.3
AP[12]=35.68
for k in APset: AP[k]=APset[k]
# OCF_k = net + DA - (AR_k-AR_{k-1}) + (AP_k-AP_{k-1})
def ocf(k): r=rows[k-1]; return r['net']+r['da']-(AR[k]-AR[k-1])+(AP[k]-AP[k-1])
AP[11]=AP[12]-(target[12]-(rows[11]['net']+rows[11]['da']-(AR[12]-AR[11])))
AP[10]=AP[11]-(target[11]-(rows[10]['net']+rows[10]['da']-(AR[11]-AR[10])))
# Jul target: solve AP[9]? AP9 fixed=39 -> check Jul OCF; adjust 'other' Jul via AP9
AP[9]=AP[10]-(target[10]-(rows[9]['net']+rows[9]['da']-(AR[10]-AR[9])))
cash_end=122.9
O=[ocf(k) for k in range(1,13)]
cin=[rows[k-1]['rev']-(AR[k]-AR[k-1]) for k in range(1,13)]
total_flow=sum(O)+sum(capex)+sum(fin)
cash0=cash_end-total_flow
c=cash0; bal=[]
for k in range(12): c+=O[k]+capex[k]+fin[k]; bal.append(c)
for k,r in enumerate(rows):
    print(f"{r['m']}: rev {r['rev']:.1f} direct {r['direct']:.1f} gp {r['gp']:.1f} ({r['gm']*100:.0f}%) opex {r['opex']:.1f} ebitda {r['ebitda']:.1f} net {r['net']:.2f} | AR {AR[k+1]:.1f} AP {AP[k+1]:.2f} cin {cin[k]:.1f} ocf {O[k]:.1f} capex {capex[k]} fin {fin[k]} cash {bal[k]:.1f}")
sn=sum(r['net'] for r in rows); print('cash0',round(cash0,1),'sum net',round(sn,1),'sumDA',round(sum(DA),2))
eq_end=359.42; cap=800+120; print('losses total',eq_end-cap,'pre-period',round(eq_end-cap-sn,1))
nbv0=200+ (52-52/48*8)+(46-46/48*2)+(18.6-18.6/48*17)+(9.8-9.8/48*9)
print("nbv0",round(nbv0,2),"equity0 BS",round(cash0+AR[0]+nbv0-AP[0],1),"vs",800+eq_end-cap-sn)
print('burn Jul-Sep avg',round(-(O[9]+O[10]+O[11])/3,2),'Aug cash in',round(cin[10],1),'Sep cash in',round(cin[11],1))
print('Jan-Sep rev',sum(R[3:]))
json.dump(dict(rows=rows,AR=AR,AP=AP,ocf=O,cin=cin,capex=capex,fin=fin,bal=bal,cash0=cash0),open('/tmp/claude-0/-home-claude-helm-finance-web/20314e75-83f8-581e-bf71-461acb831e72/scratchpad/model/pl.json','w'))
