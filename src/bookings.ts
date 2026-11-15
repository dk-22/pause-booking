import {NgTemplateOutlet} from '@angular/common';
import {HlmAlertDialog} from './ui/alert-dialog';
import {HlmDialog} from './ui/dialog';
import {UI_IMPORTS} from './ui';
import {Component,Input,Output,EventEmitter,OnInit,OnDestroy,signal,ViewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {supabase,rpc,watch,readAll} from './backend';
@Component({selector:'admin-bookings',standalone:true,imports:[UI_IMPORTS,FormsModule,NgTemplateOutlet],templateUrl:'./bookings-page.html'})
export class BookingManager implements OnInit,OnDestroy{
 @Input() campaign:any;@Input() campaignChoices:any[]=[];@Output() campaignChange=new EventEmitter<string>();
 campaignLabel=(id:string)=>this.campaignChoices.find(c=>c.id===id)?.name||this.campaign.name;status='';statusLabel=(value:string)=>({confirmed:'Confirmed',cancelled:'Cancelled'}[value]||'All statuses');
@Output() back=new EventEmitter<void>();@Output() saved=new EventEmitter<string>();@ViewChild('editor') editor?:HlmDialog;@ViewChild('confirmation') confirmation?:HlmAlertDialog;original:any=null;
 @ViewChild('cancelDialog') cancelDialog?:HlmAlertDialog;cancelTarget:any=null;cancelling=signal(false);cancelError=signal('');
 requestCancel(booking:any){this.cancelTarget={...booking};this.cancelError.set('');this.cancelDialog?.open();}
 cancelledTime(value:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
 async cancelBooking(){if(this.cancelling()||!this.cancelTarget)return;this.cancelling.set(true);this.cancelError.set('');try{await rpc('cancel_booking',{p_id:this.cancelTarget.id,p_expected:this.cancelTarget.updated_at});this.cancelDialog?.close();this.slotCacheDirty=true;await this.load();this.saved.emit('Booking cancelled.');}catch(e:any){this.cancelError.set(e.code==='PGRST202'?'Apply database migration 015 to enable booking cancellation.':e.message||'Unable to cancel the booking. Please try again.');}finally{this.cancelling.set(false);}}
 page=0;total=signal(0);refreshTimer?:ReturnType<typeof setTimeout>;loadId=0;bookings=signal<any[]>([]);loading=signal(true);saving=signal(false);error=signal('');editError=signal('');slots:any[]=[];slotCacheDirty=false;sbus:string[]=[];search='';date='';draft:any=null;originalSlot='';stops:(()=>void)[]=[];
 ngOnInit(){void this.load();this.stops.push(watch('bookings',()=>this.queueLoad(),'campaign_id=eq.'+this.campaign.id),watch('slots',()=>{this.slotCacheDirty=true;this.queueLoad();},'campaign_id=eq.'+this.campaign.id));}
 ngOnDestroy(){clearTimeout(this.refreshTimer);this.stops.forEach(s=>s());}
 queueLoad(){clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>void this.load(),200);}
 filterChanged(){}
 changePage(delta:number){this.page=Math.max(0,this.page+delta);void this.load();}
 /** Loads every booking of the campaign so the screen can group, total and export them. Filters apply on this device. */
 async load(){
  const id=++this.loadId;
  const fetchPage=(page:number)=>rpc('booking_page',{p_campaign:this.campaign.id,p_search:'',p_date:null,p_page:page});
  try{
   const [first,slots,units]=await Promise.all([fetchPage(0),this.slots.length&&!this.slotCacheDirty?Promise.resolve(this.slots):readAll((a,b)=>supabase.from('slots').select('*').eq('campaign_id',this.campaign.id).order('start_time').order('id').range(a,b)),this.sbus.length?Promise.resolve(this.sbus.map(name=>({name}))):readAll((a,b)=>supabase.from('sbus').select('name').order('name').range(a,b))]);
   if(id!==this.loadId)return;
   const rows:any[]=[...(first?.rows||[])],total=Number(first?.total||0),size=Math.max(1,rows.length||10),pages=Math.min(Math.ceil(total/size),200);
   for(let page=1;page<pages;page+=5){const batch=await Promise.all(Array.from({length:Math.min(5,pages-page)},(_,i)=>fetchPage(page+i)));if(id!==this.loadId)return;batch.forEach(result=>rows.push(...(result?.rows||[])));}
   this.slots=slots;this.slotCacheDirty=false;this.sbus=units.map(x=>x.name);this.total.set(total);this.bookings.set([...new Map(rows.map(row=>[row.id,row])).values()]);this.error.set('');
  }catch(e:any){this.error.set(e.code==='PGRST202'?'Apply database migration 012 to load bookings.':'Unable to load bookings. Please try again.');}
  finally{if(id===this.loadId)this.loading.set(false);}
 }
 // ----- What the screen shows -----
 private clock(t:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',hour:'2-digit',minute:'2-digit'}).format(new Date(t));}
 initials(name:string){return String(name||'').trim().split(/\s+/).slice(0,2).map(part=>part.charAt(0).toUpperCase()).join('')||'?';}
 setStatus(value:string){this.status=value;}
 setDate(value:string){this.date=value;}
 filtered(){const q=this.search.trim().toLowerCase();return this.bookings().filter(b=>(!this.status||b.status===this.status)&&(!this.date||this.dayOf(b)===this.date)&&(!q||[b.employee_name,b.employee_code,b.sbu].some(x=>String(x||'').toLowerCase().includes(q))));}
 dayCount(day:string){return this.bookings().filter(b=>b.status==='confirmed'&&this.dayOf(b)===day).length;}
 shortDay(day:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',weekday:'short',day:'numeric',month:'short'}).format(new Date(day+'T12:00:00+04:00'));}
 longDay(day:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(day+'T12:00:00+04:00'));}
 /** Bookings by day, then by time, with cancelled ones kept apart from the people who are coming. */
 dayGroups(){
  const rows=this.filtered(),byName=(a:any,b:any)=>String(a.employee_name).localeCompare(String(b.employee_name));
  return this.days().filter(day=>!this.date||this.date===day).map(day=>{
   const daySlots=this.slots.filter(s=>this.dayKey(s.start_time)===day);
   const slots=daySlots.map(s=>{const mine=rows.filter(b=>b.slot_id===s.id);return {id:s.id,start:this.clock(s.start_time),end:this.clock(s.end_time),capacity:s.capacity,confirmed:mine.filter(b=>b.status==='confirmed').sort(byName),cancelled:mine.filter(b=>b.status!=='confirmed').sort(byName)};}).filter(group=>group.confirmed.length||group.cancelled.length);
   const capacity=daySlots.reduce((n,s)=>n+(s.capacity||0),0),booked=daySlots.reduce((n,s)=>n+(s.booked_count||0),0);
   return {key:day,long:this.longDay(day),capacity,booked,fill:capacity?Math.min(100,Math.round(booked/capacity*100)):0,slots};
  }).filter(day=>day.slots.length);
 }
 summary(){
  const confirmed=this.bookings().filter(b=>b.status==='confirmed').length,cancelled=this.bookings().length-confirmed,capacity=this.slots.reduce((n,s)=>n+(s.capacity||0),0),now=Date.now();
  const free=this.slots.filter(s=>(s.status??'active')==='active'&&Date.parse(s.start_time)>now).reduce((n,s)=>n+Math.max(0,(s.capacity||0)-(s.booked_count||0)),0);
  return {confirmed,cancelled,free,fill:capacity?Math.min(100,Math.round(confirmed/capacity*100)):0};
 }
 shownCancelled:Record<string,boolean>={};
 cancelledOpen(slotId:string){return this.status==='cancelled'||!!this.shownCancelled[slotId];}
 /** Splits text around the search term so the match can be highlighted. */
 parts(value:string){const text=String(value??''),q=this.search.trim();if(!q)return [{text,hit:false}];const at=text.toLowerCase().indexOf(q.toLowerCase());if(at<0)return [{text,hit:false}];return [{text:text.slice(0,at),hit:false},{text:text.slice(at,at+q.length),hit:true},{text:text.slice(at+q.length),hit:false}].filter(part=>part.text);}
 shortDayLabel=(day:string)=>this.shortDay(day);
 upcomingDays(){const now=Date.now();return [...new Set(this.slots.filter(s=>Date.parse(s.start_time)>now).map(s=>this.dayKey(s.start_time)))].sort();}
 exportCsv(){
  const cell=(value:unknown)=>{const text=String(value??'');return /[",\n\r]/.test(text)||/^[=+\-@]/.test(text)?'"'+(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"':text;};
  const rows=this.filtered().slice().sort((a,b)=>(this.slots.find(s=>s.id===a.slot_id)?.start_time||'').localeCompare(this.slots.find(s=>s.id===b.slot_id)?.start_time||'')||String(a.employee_name).localeCompare(String(b.employee_name)));
  const lines=[['Date','Start','End','Name','Employee code','Business unit','Status','Cancelled by','Cancelled at'],...rows.map(b=>{const slot=this.slots.find(s=>s.id===b.slot_id);return [slot?this.dateLabel(this.dayKey(slot.start_time)):'',slot?this.clock(slot.start_time):'',slot?this.clock(slot.end_time):'',b.employee_name,b.employee_code,b.sbu,b.status==='confirmed'?'Confirmed':'Cancelled',b.cancelled_by_name||'',b.cancelled_at?this.cancelledTime(b.cancelled_at):''];})];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(line=>line.map(cell).join(',')).join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='pause-bookings-'+String(this.campaign.name||'campaign').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 print(){window.print();}
 async cancelFromEditor(){if(this.saving()||!this.original)return;const booking={...this.original};await this.editor?.close();this.requestCancel(booking);}
 dateOptionLabel=(date:string)=>date?this.dateLabel(date):'All dates';
 bookingSlotLabel=(id:string)=>this.slotLabel(id);
 dayKey(t:string){return new Date(new Date(t).getTime()+4*3600000).toISOString().slice(0,10);}
 dayOf(b:any){const s=this.slots.find(s=>s.id===b.slot_id);return s?this.dayKey(s.start_time):'';}
 days(){return [...new Set(this.slots.map(s=>this.dayKey(s.start_time)))].sort();}
 dateLabel(day:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date(day+'T12:00:00+04:00'));}
 timeLabel(id:string){const s=this.slots.find(s=>s.id===id);const f=(t:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',hour:'2-digit',minute:'2-digit'}).format(new Date(t));return s?f(s.start_time)+'–'+f(s.end_time):'Unavailable';}
 allRows(){return this.bookings().slice().sort((a,b)=>{const sa=this.slots.find(s=>s.id===a.slot_id)?.start_time||'';const sb=this.slots.find(s=>s.id===b.slot_id)?.start_time||'';return sa.localeCompare(sb);});}
 rows(day:string){const q=this.search.trim().toLowerCase();return this.bookings().filter(b=>this.dayOf(b)===day&&(!q||[b.employee_name,b.employee_code,b.sbu].some(x=>x.toLowerCase().includes(q)))).sort((a,b)=>this.timeLabel(a.slot_id).localeCompare(this.timeLabel(b.slot_id)));}
 visibleDays(){return this.days().filter(day=>(!this.date||this.date===day)&&this.rows(day).length>0);}
 destinations(){return this.slots.filter(s=>s.id===this.originalSlot||(s.status==='active'&&new Date(s.start_time).getTime()>Date.now()&&s.booked_count<s.capacity));}
 /** Employee codes are digits only: anything else is dropped as it is typed or pasted. */
 setCode(value:string,input:HTMLInputElement,model:{control:{value:unknown;setValue:(value:string,options?:object)=>void}}){const digits=String(value??'').replace(/\D/g,'');if(this.draft)this.draft.employee_code=digits;if(input.value!==digits)input.value=digits;if(model.control.value!==digits)model.control.setValue(digits,{emitEvent:false,emitModelToViewChange:false,emitViewToModelChange:false});}
 edit(b:any){this.original={...b};this.draft={...b};this.originalSlot=b.slot_id;this.editError.set('');this.editor?.open();}
 close(){if(this.saving())return;this.editor?.close();}
 cancelEdit(e:Event){e.preventDefault();this.close();}
 changes(){if(!this.draft||!this.original)return [];const fields=[['employee_name','Full name'],['employee_code','Employee code'],['sbu','Business unit'],['slot_id','Date and time']];return fields.filter(([key])=>this.draft[key]!==this.original[key]).map(([key,label])=>({label,before:key==='slot_id'?this.slotLabel(this.original[key]):this.original[key],after:key==='slot_id'?this.slotLabel(this.draft[key]):this.draft[key]}));}
 slotLabel(id:string){const slot=this.slots.find(s=>s.id===id);return slot?this.dateLabel(this.dayKey(slot.start_time))+' · '+this.timeLabel(id):'Unavailable';}
 review(){if(!this.saving()&&this.changes().length){this.editError.set('');this.confirmation?.open();}}
 async save(){if(this.saving()||!this.draft)return;this.saving.set(true);this.editError.set('');try{await rpc('update_booking',{p_id:this.draft.id,p_slot_id:this.draft.slot_id,p_name:this.draft.employee_name,p_code:this.draft.employee_code,p_sbu:this.draft.sbu,p_expected:this.draft.updated_at});this.confirmation?.close();await this.editor?.close();this.draft=null;await this.load();this.saved.emit('Booking updated.');}catch(e:any){this.confirmation?.close();this.editError.set(e.code==='PGRST202'?'Apply database migration 009 to enable booking edits.':e.message||'Unable to save booking.');}finally{this.saving.set(false);}}
}
