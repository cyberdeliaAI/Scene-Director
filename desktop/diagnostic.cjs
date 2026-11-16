'use strict';

// The local service writes "Scene Director diagnostic: <ErrorType> at <file>:<line>" for unexpected errors.
// Only that exact shape is copied into desktop.log; any other stderr output is summarized without its text,
// because it could contain request data.
const DIAGNOSTIC = /^Scene Director diagnostic: ([A-Za-z_][A-Za-z0-9_.]{0,80}) at ([A-Za-z0-9_.-]{1,80}:\d{1,6}|unknown)$/;

function describeDiagnostic(line) {
  const match = DIAGNOSTIC.exec(String(line).trim());
  return match ? `Local service error: ${match[1]} at ${match[2]}.` : 'The local service reported a diagnostic on stderr.';
}

module.exports = { describeDiagnostic };
