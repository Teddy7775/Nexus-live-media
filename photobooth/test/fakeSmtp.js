import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

/** A real SMTP server on localhost that records what it receives. Tests aim the real Mailer (nodemailer) at it. */
export async function startFakeSmtp() {
  const state = {
    messages: [], // parsed mails (mailparser)
    logins: [],
    rcptCalls: 0,
    user: 'booth@test.local',
    pass: 'correct-horse-battery',
    // (address, callNumber) => undefined to accept, or an Error with .responseCode to refuse
    rejectRcpt: null,
  };
  const server = new SMTPServer({
    authOptional: false,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onAuth(auth, session, cb) {
      state.logins.push(auth.username);
      if (auth.username === state.user && auth.password === state.pass) return cb(null, { user: auth.username });
      const err = new Error('Invalid login');
      err.responseCode = 535;
      return cb(err);
    },
    onRcptTo(address, session, cb) {
      state.rcptCalls += 1;
      cb(state.rejectRcpt?.(address.address, state.rcptCalls) ?? null);
    },
    onData(stream, session, cb) {
      // skipImageLinks keeps `cid:` image references as sent (by default mailparser rewrites them to inline data).
      simpleParser(stream, { skipImageLinks: true }).then(
        (mail) => {
          state.messages.push(mail);
          cb(null);
        },
        (err) => cb(err),
      );
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.server.address().port;
  return {
    state,
    port,
    host: '127.0.0.1',
    smtp: () => ({ host: '127.0.0.1', port, secure: false, user: state.user, pass: state.pass }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The error an SMTP server returns to refuse a recipient. */
export const smtpRefusal = (responseCode, text) => Object.assign(new Error(text), { responseCode });
