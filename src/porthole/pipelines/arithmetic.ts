type Operator = '+' | '-' | '*' | '/'
export type Arithmetic =
 | { kind: 'number'; value: number }
 | { kind: 'attribute'; name: string }
 | { kind: 'unary'; negative: boolean; value: Arithmetic }
 | { kind: 'binary'; operator: Operator; left: Arithmetic; right: Arithmetic }

const digit = (c: string) => c >= '0' && c <= '9'
const letter = (c: string) => c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c === '_'
const invalid = (): never => { throw new Error('invalid_arithmetic_expression') }

/** Native grammar only. Bound input, tree size and recursive nesting before intake. */
export function parseArithmetic(expression: string): Arithmetic {
 if (!expression.length || expression.length > 1024) return invalid()
 let cursor = 0, nodes = 0
 const peek = () => expression[cursor] ?? ''
 const space = () => { while (' \t\r\n'.includes(peek()) && cursor < expression.length) cursor++ }
 const node = (value: Arithmetic): Arithmetic => ++nodes <= 128 ? value : invalid()
 function primary(depth: number): Arithmetic {
  if (depth > 32) return invalid()
  space()
  const first = peek()
  if (first === '+' || first === '-') {
   cursor++
   return node({ kind:'unary', negative:first === '-', value:primary(depth + 1) })
  }
  if (first === '(') {
   cursor++
   const value = sum(depth + 1)
   space()
   if (peek() !== ')') return invalid()
   cursor++; return value
  }
  if (digit(first) || first === '.') {
   const start = cursor
   let digits = 0
   while (digit(peek())) { cursor++; digits++ }
   if (peek() === '.') {
    cursor++
    while (digit(peek())) { cursor++; digits++ }
   }
   if (!digits) return invalid()
   if (peek() === 'e' || peek() === 'E') {
    cursor++
    if (peek() === '+' || peek() === '-') cursor++
    const exponent = cursor
    while (digit(peek())) cursor++
    if (cursor === exponent) return invalid()
   }
   const value = Number(expression.slice(start, cursor))
   return Number.isFinite(value) ? node({ kind:'number', value }) : invalid()
  }
  if (first === '@') cursor++
  const start = cursor
  if (!letter(peek())) return invalid()
  cursor++
  while (letter(peek()) || digit(peek()) || peek() === '.') cursor++
  const name = expression.slice(start, cursor), parts = name.split('.')
  if (name.length > 120 || parts.some(part => !part || ['__proto__','prototype','constructor'].includes(part))) return invalid()
  return node({ kind:'attribute', name })
 }
 function product(depth: number): Arithmetic {
  let value = primary(depth)
  space()
  while (peek() === '*' || peek() === '/') {
   const operator = peek() as Operator; cursor++
   value = node({ kind:'binary', operator, left:value, right:primary(depth) })
   space()
  }
  return value
 }
 function sum(depth: number): Arithmetic {
  let value = product(depth)
  space()
  while (peek() === '+' || peek() === '-') {
   const operator = peek() as Operator; cursor++
   value = node({ kind:'binary', operator, left:value, right:product(depth) })
   space()
  }
  return value
 }
 const value = sum(0)
 space()
 return cursor === expression.length ? value : invalid()
}

export function evaluateArithmetic(tree: Arithmetic, attrs: Record<string, unknown>, fail: (code: string) => never): number {
 function evaluate(value: Arithmetic): number {
  if (value.kind === 'number') return value.value
  if (value.kind === 'attribute') {
   const operand = Object.hasOwn(attrs, value.name) ? attrs[value.name] : undefined
   if (typeof operand !== 'number' || !Number.isFinite(operand)) return fail('arithmetic_operand_type')
   return operand
  }
  if (value.kind === 'unary') return (value.negative ? -1 : 1) * evaluate(value.value)
  const left = evaluate(value.left), right = evaluate(value.right)
  if (value.operator === '/' && right === 0) return fail('arithmetic_divide_by_zero')
  const result = value.operator === '+' ? left + right : value.operator === '-' ? left - right : value.operator === '*' ? left * right : left / right
  return Number.isFinite(result) ? result : fail('arithmetic_numeric_range')
 }
 return evaluate(tree)
}
