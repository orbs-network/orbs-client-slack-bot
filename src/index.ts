// import { FooBarAccount } from "./foobar-account";
import { RTMClient } from "@slack/client";
import * as crypto from "crypto";
import * as bluebird from "bluebird";
import * as redis from "redis";
import * as shell from "shelljs";

bluebird.promisifyAll(redis.RedisClient.prototype);

interface Config {
  endpoint: string;
  timeout: number;
}

interface ED25519Key {
  publicKey: string;
  privateKey: string;
}

const {
  SLACK_TOKEN,
  ORBS_API_ENDPOINT,
  TRANSACTION_TIMEOUT,
  ORBS_JSON_CLIENT_PATH
} = process.env;

const PULL_REQUEST_AWARD = 100;
const VIRTUAL_CHAIN_ID = 0;

const config = {
  endpoint: ORBS_API_ENDPOINT,
  timeout: Number(TRANSACTION_TIMEOUT) || 2000
};

interface MethodArgument {
  Name: string;
  Type: Number;
  Uint64Value: Number;
}
interface Contract {
  ProtocolVersion: Number;
  VirtualChainId: Number;
  ContractName: Number;
}

interface ContractCall extends Contract {
  MethodName: string;
  Arguments: MethodArgument[];
}

function generateAddress(): ED25519Key {
  const output = shell.exec(`${ORBS_JSON_CLIENT_PATH} --generate-test-keys`).stdout.split("\n")

  return { publicKey: output[0], privateKey: output[1] };
}

async function getAccount(username: string, config: Config): Promise<ED25519Key> {
  const data = await loadAccount(username);

  let keyPair:ED25519Key;

  if (data) {
    keyPair = { publicKey: data.publicKey, privateKey: data.privateKey};
  } else {
    keyPair = generateAddress();
    await saveAccount(username, keyPair);
  }

  return Promise.resolve(keyPair);
}

// async function matchInput(message: any, condition: RegExp, botUsername: string,
//   callback: (clientAccount: FooBarAccount, botAccount: FooBarAccount, match: any) => void) {
//     const matches = message.text.match(condition);

//     if (matches) {
//       const [clientAccount, botAccount] = await Promise.all([
//         getAccount(message.user, config), getAccount(botUsername, config)
//       ]);

//       callback(clientAccount, botAccount, matches);
//     }
// }

// function mention(client: FooBarAccount) {
//   return `<@${client.username}> ${client.address}`;
// }

const redisClient: any = redis.createClient(process.env.REDIS_URL);

async function saveAccount(username: any, keyPair: any) {
  return redisClient.hmsetAsync(username, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
}

async function loadAccount(username: any) {
  return redisClient.hgetallAsync(username);
}

const rtm = new RTMClient(SLACK_TOKEN, { autoReconnect: true, useRtmConnect: true });
rtm.start({});

rtm.on("message", async (message) => {
  const BOT_USER_ID = rtm.activeUserId;
  console.log(`Connected as bot with id ${BOT_USER_ID}`);

  // For structure of `event`, see https://api.slack.com/events/message

  // Skip messages that are from a bot or my own user ID
  if ((message.subtype && message.subtype === "bot_message") ||
    (!message.subtype && message.user === rtm.activeUserId)) {
    return;
  }

  console.log(JSON.stringify(message));

  // Log the message
  console.log(`(channel:${message.channel}) ${message.user} says: ${message.text}`);
  getAccount(message.user, config).then(console.log);
});
//   try {
//     matchInput(message, /^get my address$/i, BOT_USER_ID, async (client, bot, match) => {
//       const clientBalance = await client.getMyBalance();
//       rtm.sendMessage(mention(client), message.channel);
//     });

//     matchInput(message, /^get my balance$/i, BOT_USER_ID, async (client, bot, match) => {
//       const clientBalance = await client.getMyBalance();
//       rtm.sendMessage(`${mention(client)} has ${clientBalance} magic internet money`, message.channel);
//     });

//     matchInput(message, /^get bot balance$/i, BOT_USER_ID, async (client, bot, match) => {
//       const botBalance = await bot.getMyBalance();
//       rtm.sendMessage(`${mention(bot)} now has ${botBalance} magic internet money`, message.channel);
//     });

//     matchInput(message, /^good bot gets (\d+)$/i, BOT_USER_ID, async (client, bot, match) => {
//       const amount = Number(match[1]);
//       rtm.sendMessage(`Set ${mention(bot)} balance to ${amount} magic internet money`, message.channel);

//       await bot.initBalance(bot.address, amount);

//       const balance = await bot.getMyBalance();
//       rtm.sendMessage(`${mention(bot)} now has ${balance} magic internet money`, message.channel);
//     });

//     matchInput(message, /I opened a pull request/i, BOT_USER_ID, async (client, bot, match) => {
//       rtm.sendMessage(`Transfering ${PULL_REQUEST_AWARD} to ${mention(client)}`, message.channel);
//       await bot.transfer(client.address, PULL_REQUEST_AWARD);

//       const [ clientBalance, botBalance ] = await Promise.all([client.getMyBalance(), bot.getMyBalance()]);
//       rtm.sendMessage(`${mention(client)} has ${clientBalance} magic internet money`, message.channel);
//       rtm.sendMessage(`${mention(bot)} now has ${botBalance} magic internet money`, message.channel);
//     });

//     matchInput(message, /[transfer|send] (\d+) to <@(\w+)>/, BOT_USER_ID, async (client, bot, match) => {
//       const amount = Number(match[1]);
//       const to = match[2];

//       const receiver = await getAccount(to, config);
//       rtm.sendMessage(`Transfering ${amount} from ${mention(client)} to ${mention(receiver)}`, message.channel);

//       await client.transfer(receiver.address, amount);

//       const [ clientBalance, receiverBalance ] = await Promise.all([client.getMyBalance(), receiver.getMyBalance()]);
//       rtm.sendMessage(`${mention(client)} now has ${clientBalance} magic internet money`, message.channel);
//       rtm.sendMessage(`${mention(receiver)} now has ${receiverBalance} magic internet money`, message.channel);
//     });
//   } catch (e) {
//     console.log(`Error occurred: ${e}`);
//   }

// });
