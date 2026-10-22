let wheelSwapInstallPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();wheelSwapInstallPrompt=event;});
window.addEventListener('appinstalled',()=>{wheelSwapInstallPrompt=null;document.getElementById('installApp').hidden=true;});
if(window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone)document.getElementById('installApp').hidden=true;
async function installWheelSwap(){
 if(wheelSwapInstallPrompt){const prompt=wheelSwapInstallPrompt;wheelSwapInstallPrompt=null;await prompt.prompt();await prompt.userChoice;return;}
 let modal=document.getElementById('installModal');
 if(!modal){document.body.insertAdjacentHTML('beforeend',`<div id="installModal" class="modal"><div class="panel"><div class="panelhead"><h2>Install WheelSwap</h2><button class="x" onclick="closeModal('installModal')" aria-label="Close install instructions">×</button></div><p>Keep WheelSwap on your home screen and open it like an app.</p><h3>iPhone or iPad</h3><p>Open wheelswapusa.com in Safari. Tap <strong>Share → Add to Home Screen</strong>, turn on <strong>Open as Web App</strong> if shown, then tap <strong>Add</strong>.</p><h3>Android</h3><p>Open wheelswapusa.com in Chrome. Tap the <strong>⋮ menu → Add to Home screen → Install</strong>. The wording may vary by device.</p><p class="note">An internet connection is needed for accounts, current listings, photos, and publishing. This app is installed from the website.</p></div></div>`);modal=document.getElementById('installModal');modal.addEventListener('click',e=>{if(e.target===modal)closeModal('installModal')});}
 modal.classList.add('open');
}
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{/* Site remains usable if installation support is unavailable. */});});}
