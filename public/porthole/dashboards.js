// Pointer reorder has the same server-side revision guard as keyboard buttons.
const panels=document.querySelector('[aria-label="Dashboard panels"]'),form=document.querySelector('#drag-order');
let dragged;
if(panels&&form){
 panels.addEventListener('dragstart',event=>{dragged=event.target.closest('[data-panel]');event.dataTransfer.effectAllowed='move'});
 panels.addEventListener('dragover',event=>{if(dragged)event.preventDefault()});
 panels.addEventListener('drop',event=>{event.preventDefault();const target=event.target.closest('[data-panel]');if(!dragged||!target||dragged===target)return;panels.insertBefore(dragged,target);form.elements.order.value=JSON.stringify([...panels.querySelectorAll('[data-panel]')].map(panel=>panel.dataset.panel));form.requestSubmit()});
 panels.addEventListener('dragend',()=>{dragged=null});
}
