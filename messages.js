let activeConversation=null,messagePoll=null,messageLoading=false,messageLimit=100,messageUserId=null,unreadMessageIds=new Set(),lastInboxCheck=0;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="messagesModal"><div class="panel" style="width:min(100%,760px)"><div class="panelhead"><h2>Messages <span id="inboxUnread" style="color:#ff8b4d"></span></h2><button class="x" onclick="closeMessages()" aria-label="Close messages">×</button></div><button class="btn ghost" onclick="loadConversations()">All conversations</button><button class="btn ghost" style="margin-left:8px" onclick="enableMessageAlerts()">🔔 Enable phone alerts</button><h3 id="conversationTitle">Your conversations</h3><div id="conversationList"></div><div id="messageThread" hidden><div id="messageHistory" style="height:min(50vh,460px);overflow:auto" role="log" aria-label="Conversation messages"></div><button class="btn ghost" onclick="showEarlierMessages()">Show earlier messages</button><form id="messageForm"><label for="messageText">MESSAGE</label><textarea id="messageText" required maxlength="3000" rows="2" placeholder="Ask about availability, fitment, or pickup..."></textarea><button id="sendMessage" class="btn" style="margin-top:10px">Send message</button></form></div><p class="note" role="status" id="messageStatus"></p><p class="note">Messages are visible only to the buyer and seller in this conversation. Agree on payment and delivery directly. WheelSwap does not handle your purchase payment.</p></div></div>`);
async function enableMessageAlerts(){
 if(!('Notification' in window)){toast('Notifications are not supported in this browser. On iPhone, install WheelSwap to your Home Screen first.');return}
 try{
  const result=await Notification.requestPermission();
  toast(result==='granted'?'Phone alerts enabled while WheelSwap is open.':'Notifications were not enabled.');
 }catch(e){toast('Unable to enable notifications on this device.')}
}
function closeMessages(){clearInterval(messagePoll);messagePoll=null;activeConversation=null;$('messageText').value='';$('messageHistory').replaceChildren();$('conversationList').replaceChildren();closeModal('messagesModal');}
$('messagesModal').addEventListener('click',e=>{if(e.target===$('messagesModal'))closeMessages()});
function messagingSession(){if(!currentUser){closeMessages();openAccount();return false}return true;}
function startMessagePoll(){clearInterval(messagePoll);messageUserId=currentUser.id;messagePoll=setInterval(()=>{if(!currentUser||currentUser.id!==messageUserId||!$('messagesModal').classList.contains('open')){closeMessages();return}if(!document.hidden&&!messageLoading){checkInboxNotifications();if(activeConversation)refreshMessages();else loadConversations(false)}},5000);}
async function openMessages(){if(!messagingSession())return;$('messagesModal').classList.add('open');await loadConversations();await checkInboxNotifications();startMessagePoll();}
async function loadConversations(reset=true){if(!messagingSession())return;const userId=currentUser.id;if(reset){activeConversation=null;$('messageThread').hidden=true;$('conversationList').hidden=false;$('conversationTitle').textContent='Your conversations';$('messageStatus').textContent='';}try{const rows=checked(await cloud.from('conversations').select('id,listing_id,buyer_id,seller_id,created_at,listings(title)').order('created_at',{ascending:false}).limit(100));if(currentUser?.id!==userId)return;$('conversationList').innerHTML=rows.length?rows.map(c=>`<button class="btn ghost" style="display:block;width:100%;text-align:left;margin:10px 0" onclick="selectConversation('${c.id}')">${unreadMessageIds.has(c.id)?'<span style="color:#ff8b4d">● NEW </span>':''}${esc(c.listings?.title||'Wheel listing')}<br><small>${c.seller_id===currentUser.id?'Buyer inquiry':'Your inquiry to seller'}</small></button>`).join(''):'<p class="note">No conversations yet. Open a listing and tap Message seller.</p>';}catch(e){$('messageStatus').textContent=e.message;}}
async function messageSeller(listingId){if(!messagingSession())return;const l=listings.find(x=>x.id===listingId);if(!l?.seller_id||l.seller_id===currentUser.id){toast('Open Messages to read buyer inquiries.');return}$('messagesModal').classList.add('open');$('messageStatus').textContent='Opening conversation…';try{let existing=checked(await cloud.from('conversations').select('id').eq('listing_id',listingId).eq('buyer_id',currentUser.id).maybeSingle());if(!existing){const result=await cloud.from('conversations').insert({listing_id:listingId,buyer_id:currentUser.id,seller_id:l.seller_id}).select('id').single();if(result.error?.code==='23505')existing=checked(await cloud.from('conversations').select('id').eq('listing_id',listingId).eq('buyer_id',currentUser.id).single());else existing=checked(result);}await selectConversation(existing.id);startMessagePoll();}catch(e){$('messageStatus').textContent=e.message;}}
async function selectConversation(id){if(!messagingSession()||!uuidPattern.test(id))return;const userId=currentUser.id;try{const c=checked(await cloud.from('conversations').select('id,buyer_id,seller_id,listings(title)').eq('id',id).single());if(currentUser?.id!==userId)return;if(![c.buyer_id,c.seller_id].includes(currentUser.id))throw Error('Conversation unavailable.');activeConversation=id;messageLimit=100;$('messageText').value='';$('messageHistory').replaceChildren();$('conversationList').hidden=true;$('messageThread').hidden=false;$('conversationTitle').textContent=c.listings?.title||'Wheel listing';$('messageStatus').textContent='';await refreshMessages();await checkInboxNotifications();}catch(e){$('messageStatus').textContent=e.message;}}
async function refreshMessages(){if(!messagingSession()||!activeConversation||messageLoading)return;messageLoading=true;const conversation=activeConversation,userId=currentUser.id;try{const rows=checked(await cloud.from('messages').select('id,sender_id,body,created_at').eq('conversation_id',conversation).order('created_at',{ascending:false}).limit(messageLimit));if(activeConversation!==conversation||currentUser?.id!==userId)return;const history=$('messageHistory'),nearBottom=history.scrollHeight-history.scrollTop-history.clientHeight<80;history.innerHTML=rows.reverse().map(m=>`<div style="margin:10px 0;padding:12px;border-radius:10px;background:${m.sender_id===userId?'#713617':'#252931'}"><strong>${m.sender_id===userId?'You':'Other participant'}</strong><p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0">${esc(m.body)}</p><small class="muted">${esc(new Date(m.created_at).toLocaleString())}</small></div>`).join('')||'<p class="note">Start the conversation below.</p>';if(nearBottom)history.scrollTop=history.scrollHeight;}catch(e){$('messageStatus').textContent=e.message}finally{messageLoading=false}}
function showEarlierMessages(){messageLimit+=100;refreshMessages();}
$('messageForm').addEventListener('submit',async e=>{e.preventDefault();if(!messagingSession()||!activeConversation)return;const body=$('messageText').value.trim();if(!body)return;const b=$('sendMessage');b.disabled=true;try{checked(await cloud.from('messages').insert({conversation_id:activeConversation,sender_id:currentUser.id,body}));$('messageText').value='';$('messageStatus').textContent='Message sent.';await refreshMessages();}catch(e){$('messageStatus').textContent=e.message}finally{b.disabled=false}});
// Unread indicators are based on incoming messages since the last time this device opened each thread.
const seenKey=id=>'wheelswap_seen_'+id;
async function checkInboxNotifications(){
 if(!currentUser||!cloud)return;
 const uid=currentUser.id;
 try{
  const cs=checked(await cloud.from('conversations').select('id').limit(100));
  if(currentUser?.id!==uid)return;
  const ids=cs.map(c=>c.id);
  if(!ids.length){unreadMessageIds.clear();updateInboxBadge();return}
  const incoming=checked(await cloud.from('messages').select('id,conversation_id,created_at,sender_id').in('conversation_id',ids).neq('sender_id',uid).order('created_at',{ascending:false}).limit(300));
  const unread=new Set();
  for(const m of incoming){
   const seen=localStorage.getItem(seenKey(m.conversation_id));
   if(!seen||new Date(m.created_at).getTime()>Number(seen))unread.add(m.conversation_id);
  }
  if(activeConversation&&$('messagesModal').classList.contains('open')&&!$('messageThread').hidden){
   localStorage.setItem(seenKey(activeConversation),String(Date.now()));
   unread.delete(activeConversation);
  }
  const newly=[...unread].filter(id=>!unreadMessageIds.has(id));
  unreadMessageIds=unread;updateInboxBadge();
  if(lastInboxCheck&&newly.length&&document.visibilityState==='visible'){
   toast('You have a new WheelSwap message!');
   if('Notification' in window&&Notification.permission==='granted')new Notification('WheelSwap: New message',{body:'A buyer or seller has replied. Open Messages to respond.'});
  }
  lastInboxCheck=Date.now();
 }catch(e){console.warn('Inbox notification check failed',e)}
}
function updateInboxBadge(){
 const count=unreadMessageIds.size;
 const nav=[...document.querySelectorAll('button')].find(b=>b.getAttribute('onclick')==='openMessages()');
 if(nav)nav.textContent='Messages'+(count?' ('+count+')':'');
 $('inboxUnread').textContent=count?'• '+count+' unread':'';
 document.title=(count?'('+count+') ':'')+'WheelSwap USA | Buy, Sell & Trade Wheels and Tires';
}
const previousSelectConversation=selectConversation;
selectConversation=async function(id){
 await previousSelectConversation(id);
 if(activeConversation===id){
  localStorage.setItem(seenKey(id),String(Date.now()));
  unreadMessageIds.delete(id);updateInboxBadge();
 }
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkInboxNotifications()});
setInterval(()=>{if(currentUser&&!document.hidden)checkInboxNotifications()},15000);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(checkInboxNotifications,1500));
else setTimeout(checkInboxNotifications,1500);
const contactViewListing=viewListing;viewListing=function(id){contactViewListing(id);const l=listings.find(x=>x.id===id);if(l?.seller_id&&l.seller_id!==currentUser?.id)$('detailBody').insertAdjacentHTML('beforeend',`<button class="btn" style="width:100%;margin-top:12px" onclick="messageSeller('${l.id}')">Message seller</button>`);};
if(cloud)cloud.auth.onAuthStateChange((_event,session)=>{if(!session||session.user.id!==messageUserId)closeMessages();});
