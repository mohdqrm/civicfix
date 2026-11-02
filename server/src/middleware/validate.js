// Zod validation middleware. A route declares the shape it expects, e.g.
//   router.post('/', validate({ body: registerSchema }), handler)
// Invalid input is rejected with HTTP 400 and a list of field errors before the
// handler runs. Valid, cleaned values (trimmed strings, numbers converted from
// text, defaults filled in) are stored on req.valid.body / .query / .params, and
// handlers read from there — never from the raw req.body.
import { badRequest } from '../utils/errors.js';

export function validate(schemas) {
  return (req, _res, next) => {
    const details = [];
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (result.success) {
        req.valid = { ...(req.valid ?? {}), [part]: result.data };
      } else {
        for (const issue of result.error.issues) {
          details.push({ field: issue.path.join('.') || part, message: issue.message });
        }
      }
    }
    if (details.length) return next(badRequest('Some fields are invalid', details));
    next();
  };
}
