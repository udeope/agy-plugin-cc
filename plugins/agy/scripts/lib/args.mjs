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

const YOLO_FLAG = '--dangerously-skip-permissions';

// Flags are only recognised before the first positional token, or before an
// explicit `--`. Everything from there on is prompt text and is passed through
// untouched.
//
// Slash commands hand the whole invocation over as one string, so the task text
// is tokenized alongside the flags. Scanning the entire token list would let a
// task like "explain what the --write flag does" both silently leave the sandbox
// and lose the word from the prompt the model receives. With
// --dangerously-skip-permissions in the set, a task that merely *warns against*
// the flag would have switched it on.
function parseFlags(args) {
  const flags = {
    json: false,
    authCheck: false,
    background: false,
    wait: false,
    write: false,
    readOnly: false,
    continueConversation: false,
    conversation: null,
    base: null,
    dangerouslySkipPermissions: false,
    // Set when the yolo flag appears somewhere the parser will not honour it, so
    // callers can fail loudly instead of silently running with permissions on.
    yoloMisplaced: false,
    positional: [],
  };

  let i = 0;
  for (; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      i += 1;
      break;
    }

    if (arg === '--json') flags.json = true;
    else if (arg === '--auth-check') flags.authCheck = true;
    else if (arg === '--background') flags.background = true;
    else if (arg === '--wait') flags.wait = true;
    else if (arg === '--write') flags.write = true;
    else if (arg === '--read-only' || arg === '--readonly') flags.readOnly = true;
    else if (arg === '--continue') flags.continueConversation = true;
    // Forwarded to agy as --dangerously-skip-permissions, which auto-approves
    // every permission request. Recognised only as the very first token:
    // leading-flag parsing alone already keeps it out of task text, and this
    // second rule means no future parser change can reintroduce that reach.
    // Anywhere else it is refused rather than ignored, so a misplaced flag is
    // never mistaken for a run that still prompted for approval.
    else if (arg === YOLO_FLAG) {
      if (i === 0) flags.dangerouslySkipPermissions = true;
      else flags.yoloMisplaced = true;
    }
    else if (arg === '--base') flags.base = requireValue(args, ++i, '--base');
    else if (arg.startsWith('--base=')) flags.base = arg.slice('--base='.length);
    else if (arg === '--conversation') flags.conversation = requireValue(args, ++i, '--conversation');
    else if (arg.startsWith('--conversation=')) flags.conversation = arg.slice('--conversation='.length);
    else break;
  }

  flags.positional = args.slice(i);
  return flags;
}

function requireValue(args, index, flag) {
  if (index >= args.length || args[index].startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index];
}

export { YOLO_FLAG, parseFlags, parseInvocationArgs, requireValue, shellSplit };
