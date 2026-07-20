'use strict';

async function mutate(fetcher, invalidate, pathname, options = {}) {
  const result = await fetcher(pathname, options);
  invalidate();
  return result;
}

function serializeExport(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

module.exports = { mutate, serializeExport };
