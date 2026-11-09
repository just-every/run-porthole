const image=(parts,digest)=>parts.join('/')+'@sha256:'+digest
export const releases={
 kafka:image(['apache', 'kafka'],'4ceccc577f03f51f6af8dbfda55194d0d892f4fa7913ffbded567ce3895622ed'),
 rabbitmq:'rabbitmq@sha256:294b01e1796a8acede4619f32a1c394fae1f8021e57986ea01aad38dc2a4f502',
}
