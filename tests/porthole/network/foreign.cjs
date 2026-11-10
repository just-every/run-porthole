// Negative source control: real counted messages, without assigning this
// private virtual host to the application's telemetry or collection identity.
const amqp=require('amqplib')
async function run(){
 const connection=await amqp.connect({hostname:'rabbit',username:'workload',password:process.env.WORKLOAD_PASSWORD,vhost:'synthetic-porthole-foreign'})
 try{const channel=await connection.createConfirmChannel();await channel.assertQueue(process.env.DESTINATION,{durable:false});for(let i=0;i<7;i++)channel.sendToQueue(process.env.DESTINATION,Buffer.from('synthetic-porthole-foreign-'+i));await channel.waitForConfirms();console.log(JSON.stringify({sent:7,virtualHost:'synthetic-porthole-foreign',destination:process.env.DESTINATION}));await channel.close()}finally{await connection.close()}
}
run().catch(()=>{process.stderr.write('foreign namespace workload failed\n');process.exit(1)})
