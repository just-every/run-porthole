// Pointer reorder has the same server-side revision guard as keyboard buttons.
const panels=document.querySelector('[aria-label="Panel order"]'),form=document.querySelector('#drag-order');
let dragged;
if(panels&&form){
 panels.addEventListener('dragstart',event=>{if(!event.dataTransfer)return;dragged=event.target.closest('[data-order-panel]');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragged.dataset.orderPanel)});
 panels.addEventListener('dragover',event=>{if(dragged)event.preventDefault()});
 panels.addEventListener('drop',event=>{event.preventDefault();const target=event.target.closest('[data-order-panel]');if(!dragged||!target||dragged===target)return;panels.insertBefore(dragged,target);form.elements.order.value=JSON.stringify([...panels.querySelectorAll('[data-order-panel]')].map(panel=>panel.dataset.orderPanel));form.requestSubmit()});
 panels.addEventListener('dragend',()=>{dragged=null});
}
