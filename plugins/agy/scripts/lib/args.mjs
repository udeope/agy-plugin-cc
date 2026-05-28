// Argument parsing for the agy companion CLI.
// Pure functions: no filesystem or process access.

function parseInvocationArgs(rawArgs) {
  if (rawArgs.length === 1) {
    return shellSplit(rawArgs[0]);
  }
  return rawArgs;
}

function shellSplit(input) {
  const out = [];
  let token = '';
  let quote = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      token += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (token.length > 0) {
        out.push(token);
        token = '';
      }
      continue;
    }
    token += char;
  }

  if (escaping) {
    token += '\\';
  }
  if (quote) {
    throw new Error(`unterminated ${quote} quote in arguments`);
  }
  if (token.length > 0) {
    out.push(token);
  }
  return out;
}

function parseFlags(args) {
  const flags = {
    json: false,
    authCheck: false,
    background: false,
    wait: false,
    write: false,
    continueConversation: false,
    conversation: null,
    base: null,
    dangerouslySkipPermissions: false,
    positional: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      flags.positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--json') flags.json = true;
    else if (arg === '--auth-check') flags.authCheck = true;
    else if (arg === '--background') flags.background = true;
    else if (arg === '--wait') flags.wait = true;
    else if (arg === '--write') flags.write = true;
    else if (arg === '--continue') flags.continueConversation = true;
    else if (arg === '--dangerously-skip-permissions') flags.dangerouslySkipPermissions = true;
    else if (arg === '--base') flags.base = requireValue(args, ++i, '--base');
    else if (arg.startsWith('--base=')) flags.base = arg.slice('--base='.length);
    else if (arg === '--conversation') flags.conversation = requireValue(args, ++i, '--conversation');
    else if (arg.startsWith('--conversation=')) flags.conversation = arg.slice('--conversation='.length);
    else flags.positional.push(arg);
  }

  return flags;
}

function requireValue(args, index, flag) {
  if (index >= args.length || args[index].startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index];
}

export { parseFlags, parseInvocationArgs, requireValue, shellSplit };
