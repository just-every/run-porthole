export function fingerprint(sql:unknown):string
export function reviewedPlans(value:unknown):string[]
export function structuralPlan(plan:unknown,engine:string):{operator:string;estimatedRows?:number;estimatedCost?:number;estimatedWidth?:number;estimatedOutputRows?:number}[]
