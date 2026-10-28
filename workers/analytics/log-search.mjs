const bounds = { expression: 2048, nodes: 128, terms: 32, depth: 16, value: 512 };
const scopes = { service: 'services', environment: 'environments', team: 'teams' };
const reserved = new Set(['service', 'environment', 'team', 'status', 'host']);
const comparisons = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
export class LogSearchError extends Error {
 constructor(code, hint, field = 'expression', status = 400) {
  super(code); this.code = code; this.hint = hint; this.field = field; this.status = status;
 }
}
const refuse = (hint, code = 'unsupported_log_search', field = 'expression', status = 400) => { throw new LogSearchError(code, hint, field, status); };
const malformed = () => refuse('Supply a bounded, valid log-search plan produced by the expression parser.', 'invalid_log_search_plan');
const printable = value => typeof value === 'string' && value.length <= bounds.value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const scalar = value => printable(value) || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
function fieldName(value) {
 if (value === 'env') return 'environment';
 if (reserved.has(value)) return value;
 if (typeof value === 'string' && /^@[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,119}$/.test(value) && value.slice(1).split('.').every(part => part.length) && value.split('.').length <= bounds.depth) return value;
 refuse('Use service, status, host, environment, env, team or an @attribute path.', 'unsupported_log_search_field');
}
function patternParts(pattern) {
 const output = []; let wildcard = false;
 for (let i = 0; i < pattern.length; i++) {
  const escaped = pattern[i] === '\\';
  if (escaped && ++i === pattern.length) refuse('Finish the escaped value with a literal character.');
  const char = pattern[i], active = !escaped && (char === '*' || char === '?');
  wildcard ||= active; output.push({ char, active });
 }
 return { output, wildcard };
}
function literal(token, typed = true) {
 if (!token || !['atom', 'quoted'].includes(token.type)) refuse('Supply a literal value after the field and colon.');
 const { output, wildcard } = token.type === 'quoted' ? { output: [...token.text].map(char => ({ char })), wildcard: false } : patternParts(token.text);
 const value = output.map(part => part.char).join('');
 if (!printable(value)) refuse('Use printable attribute values of at most 512 characters.');
 if (token.type === 'atom' && wildcard) return { operator: token.text === '*' ? 'exists' : 'glob', value: token.text };
 if (typed && token.type === 'atom' && !token.text.includes('\\')) {
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
   const number = Number(value);
   if (!scalar(number)) refuse('Use a finite number with an exactly representable integer; quote text values.');
   return { operator: 'eq', value: number };
  }
  if (value === 'true' || value === 'false') return { operator: 'eq', value: value === 'true' };
 }
 return { operator: 'eq', value };
}
function tokenize(expression) {
 const tokens = [];
 for (let i = 0; i < expression.length;) {
  const char = expression[i];
  if (/\s/u.test(char)) { i++; continue; }
  if ('():[]{}-'.includes(char)) { tokens.push({ type: char, text: char }); i++; continue; }
  if (char === '>' || char === '<') {
   const text = char + (expression[i + 1] === '=' ? '=' : '');
   tokens.push({ type: 'comparison', text }); i += text.length; continue;
  }
  if (char === '"') {
   let text = '', closed = false; i++;
   while (i < expression.length) {
    if (expression[i] === '"') { i++; closed = true; break; }
    if (expression[i] === '\\' && ++i === expression.length) break;
    text += expression[i++];
   }
   if (!closed) refuse('Close the quoted attribute value.');
   tokens.push({ type: 'quoted', text }); continue;
  }
  let text = '';
  while (i < expression.length && !/[\s():\[\]{}<>"]/u.test(expression[i])) {
   if (expression[i] === '\\') {
    if (i + 1 === expression.length) refuse('Finish the escaped value with a literal character.');
    text += expression[i++] + expression[i++]; continue;
   }
   if (/[~^!+=&|;]/u.test(expression[i])) refuse('Regex, fuzzy matching, boosting and symbolic boolean operators are unsupported; use literals, wildcards, AND, OR and NOT.');
   text += expression[i++];
  }
  if (!text) refuse('Use supported field predicates and boolean grouping.');
  if (text.startsWith('/') && text.endsWith('/') && text.length > 1) refuse('Regex predicates are unsupported; use a quoted literal or * and ? wildcards.');
  tokens.push({ type: 'atom', text });
  if (tokens.length > bounds.nodes * 5) refuse('Reduce the number of log-search predicates.', 'log_search_limit');
 }
 return tokens;
}
export function parseLogSearch(expression) {
 if (typeof expression !== 'string' || !expression.trim() || expression.length > bounds.expression || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(expression)) refuse('Enter printable log-search text of at most 2048 characters.', 'invalid_log_search');
 const tokens = tokenize(expression); let position = 0, count = 0;
 const peek = type => tokens[position]?.type === type;
 const keyword = text => peek('atom') && tokens[position].text === text;
 const take = type => { if (!peek(type)) refuse('Complete each field:value predicate and close its grouping or range.'); return tokens[position++]; };
 const value = typed => {
  const negative = peek('-'); if (negative) position++;
  const token = tokens[position++];
  if (negative && token?.type !== 'atom') refuse('Place a negative number after the comparison, or quote a negative text value.');
  return literal(negative ? { ...token, text: '-' + token.text } : token, typed);
 };
 const term = () => {
  if (++count > bounds.terms) refuse('Use at most 32 log-search predicates.', 'log_search_limit');
  const field = fieldName(take('atom').text); take(':');
  let operation;
  if (peek('[') || peek('{')) {
   const includeLower = peek('['); position++;
   const lower = value(true);
   if (!keyword('TO')) refuse('Separate range endpoints with uppercase TO.');
   position++; const upper = value(true);
   if (!peek(']') && !peek('}')) refuse('Close the range with ] for inclusion or } for exclusion.');
   const includeUpper = peek(']'); position++;
   if (![lower.operator, upper.operator].every(operator => ['eq', 'exists'].includes(operator))) refuse('Use literal range endpoints or * for an open endpoint.');
   operation = { operator: 'range', lower: lower.operator === 'exists' ? null : lower.value, upper: upper.operator === 'exists' ? null : upper.value, includeLower, includeUpper };
  } else if (peek('comparison')) {
   const operator = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' }[tokens[position++].text], operand = value(true);
   if (operand.operator !== 'eq' || typeof operand.value !== 'number') refuse('Use a numeric comparison operand; quote text for exact equality and use :* for existence.');
   operation = { operator, value: operand.value };
  } else {
   operation = value(field.startsWith('@'));
   if (operation.operator === 'exists') operation = { operator: 'exists' };
  }
  return { op: 'term', field, ...operation };
 };
 const unary = depth => {
  if (depth > bounds.depth) refuse('Use at most 16 levels of boolean grouping or exclusion.', 'log_search_limit');
  if (peek('-') || keyword('NOT')) { position++; return { op: 'not', child: unary(depth + 1) }; }
  if (peek('(')) {
   position++; const node = disjunction(depth + 1); take(')'); return node;
  }
  return term();
 };
 const conjunction = depth => {
  const children = [unary(depth)];
  while (position < tokens.length && !peek(')') && !keyword('OR')) {
   if (keyword('AND')) position++;
   children.push(unary(depth));
  }
  return children.length === 1 ? children[0] : { op: 'and', children };
 };
 const disjunction = depth => {
  const children = [conjunction(depth)];
  while (keyword('OR')) { position++; children.push(conjunction(depth)); }
  return children.length === 1 ? children[0] : { op: 'or', children };
 };
 const root = disjunction(1);
 if (position !== tokens.length) refuse('Remove an unmatched closing group or unsupported trailing syntax.');
 return validateLogSearch({ version: 1, root });
}
export function validateLogSearch(plan) {
 const shape = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) malformed();
 };
 shape(plan, ['version', 'root']); if (plan.version !== 1) malformed();
 let nodes = 0, terms = 0;
 const visit = (node, depth) => {
  if (++nodes > bounds.nodes || depth > bounds.depth) refuse('Reduce the log-search plan to 128 nodes and 16 levels.', 'log_search_limit');
  if (!node || typeof node !== 'object') malformed();
  if (node.op === 'and' || node.op === 'or') {
   shape(node, ['op', 'children']);
   if (!Array.isArray(node.children) || node.children.length < 2 || node.children.length > bounds.nodes) malformed();
   return { op: node.op, children: node.children.map(child => visit(child, depth + 1)) };
  }
  if (node.op === 'not') { shape(node, ['op', 'child']); return { op: 'not', child: visit(node.child, depth + 1) }; }
  if (node.op !== 'term' || ++terms > bounds.terms) malformed();
  const field = fieldName(node.field), operator = node.operator;
  if (operator === 'exists') { shape(node, ['op', 'field', 'operator']); return { op: 'term', field, operator }; }
  if (operator === 'range') {
   shape(node, ['op', 'field', 'operator', 'lower', 'upper', 'includeLower', 'includeUpper']);
   const endpoints = [node.lower, node.upper].filter(value => value !== null);
   if (!field.startsWith('@') || !endpoints.length || endpoints.some(value => !scalar(value) || typeof value !== 'number') || typeof node.includeLower !== 'boolean' || typeof node.includeUpper !== 'boolean') refuse('Use a typed @attribute range with numeric endpoints; use :* for existence.');
   if (node.lower !== null && node.upper !== null && node.lower > node.upper) refuse('Place the lower range endpoint before the upper endpoint.');
   return { op: 'term', field, operator, lower: node.lower, upper: node.upper, includeLower: node.includeLower, includeUpper: node.includeUpper };
  }
  shape(node, ['op', 'field', 'operator', 'value']);
  if (!['eq', 'glob', ...Object.keys(comparisons)].includes(operator) || !scalar(node.value)) malformed();
  if (operator === 'glob' && (typeof node.value !== 'string' || !patternParts(node.value).wildcard)) malformed();
  if (Object.hasOwn(comparisons, operator) && (typeof node.value !== 'number' || !field.startsWith('@'))) refuse('Apply numeric comparisons to an @attribute path.');
  if (!field.startsWith('@') && typeof node.value !== 'string') refuse('Reserved tags require text values; apply numeric comparisons to @attribute paths.');
  return { op: 'term', field, operator, value: node.value };
 };
 return { version: 1, root: visit(plan.root, 1) };
}
function glob(pattern) {
 return patternParts(pattern).output.map(({ char, active }) => active ? char : ({ '*': '[*]', '?': '[?]', '[': '[[]' }[char] ?? char)).join('');
}
function typedValue(value, type) {
 if (type === 'string') return { valid: `json_type(${value},'$.stringValue')='text'`, sql: `json_extract(${value},'$.stringValue') COLLATE BINARY` };
 if (type === 'boolean') return { valid: `json_type(${value},'$.boolValue') IN ('true','false')`, sql: `json_extract(${value},'$.boolValue')` };
 const int = `json_extract(${value},'$.intValue')`, double = `json_extract(${value},'$.doubleValue')`;
 const integer = `(json_type(${value},'$.intValue')='integer' OR (json_type(${value},'$.intValue')='text' AND CAST(CAST(${int} AS INTEGER) AS TEXT)=${int}))`;
 const valid = `(${integer} OR json_type(${value},'$.doubleValue') IN ('integer','real'))`;
 return { valid, sql: `(CASE WHEN ${integer} THEN CAST(${int} AS INTEGER) WHEN json_type(${value},'$.doubleValue') IN ('integer','real') THEN ${double} END)` };
}
export function compileLogSearch(input, scope) {
 const plan = validateLogSearch(input), args = [];
 if (scope !== undefined) {
  if (!scope || typeof scope !== 'object' || Object.values(scopes).some(key => !Array.isArray(scope[key]) || scope[key].length > 100 || scope[key].some(value => typeof value !== 'string' || value.length > 120))) malformed();
 }
 const bind = value => { args.push(typeof value === 'boolean' ? Number(value) : value); return '?'; };
 const predicate = (node, source) => {
  if (node.operator === 'exists') return source.valid;
  if (node.operator === 'glob') return `(${source.valid} AND ${source.sql} GLOB ${bind(glob(node.field === 'status' ? node.value.toLowerCase() : node.value))})`;
  if (node.operator === 'range') {
   const conditions = [source.valid];
   if (node.lower !== null) conditions.push(`${source.sql}${node.includeLower ? '>=' : '>'}${bind(node.lower)}`);
   if (node.upper !== null) conditions.push(`${source.sql}${node.includeUpper ? '<=' : '<'}${bind(node.upper)}`);
   return '(' + conditions.join(' AND ') + ')';
  }
  return `(${source.valid} AND ${source.sql}${comparisons[node.operator] ?? '='}${bind(node.field === 'status' ? node.value.toLowerCase() : node.value)})`;
 };
 const attribute = (node, path) => {
  bind(path); bind(path);
  const sample = node.operator === 'range' ? node.lower ?? node.upper : node.value;
  const condition = node.operator === 'exists' ? '1' : predicate(node, typedValue('a.value', typeof sample));
  return `EXISTS(WITH RECURSIVE log_attrs(path,value,depth) AS (
   SELECT json_extract(j.value,'$.key'),json_extract(j.value,'$.value'),1 FROM json_each(r.payload,'$.record.attributes') j
   UNION ALL SELECT json_extract(j.value,'$.key'),json_extract(j.value,'$.value'),1 FROM json_each(r.payload,'$.resource.attributes') j
   UNION ALL SELECT a.path||'.'||json_extract(j.value,'$.key'),json_extract(j.value,'$.value'),a.depth+1 FROM log_attrs a,json_each(a.value,'$.kvlistValue.values') j
   WHERE a.depth<16 AND substr(?,1,length(a.path)+1)=a.path||'.'
  ) SELECT 1 FROM log_attrs a WHERE a.path=? AND ${condition})`;
 };
 const visit = node => {
  if (node.op === 'and' || node.op === 'or') return '(' + node.children.map(visit).join(node.op === 'and' ? ' AND ' : ' OR ') + ')';
  if (node.op === 'not') return '(NOT ' + visit(node.child) + ')';
  if (Object.hasOwn(scopes, node.field)) {
   if (scope && node.operator === 'eq' && !scope[scopes[node.field]].includes('*') && !scope[scopes[node.field]].includes(node.value)) refuse('Select a scope value permitted by the current query authority.', 'scope_forbidden', node.field, 403);
   return 'COALESCE(' + predicate(node, { valid: `r.${node.field} IS NOT NULL`, sql: `r.${node.field} COLLATE BINARY` }) + ',0)';
  }
  if (node.field === 'host') return attribute(node, 'host.name');
  if (node.field === 'status') return 'COALESCE(' + predicate(node, { valid: `json_type(r.payload,'$.record.severityText')='text'`, sql: `lower(json_extract(r.payload,'$.record.severityText'))` }) + ',0)';
  return attribute(node, node.field.slice(1));
 };
 return { sql: visit(plan.root), args };
}
