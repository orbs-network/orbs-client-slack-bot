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

interface Account {
  address: string;
  publicKey: string;
  privateKey: string;
  username: string;
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
  Uint64Value?: Number;
  BytesValue?: string;
}
interface Contract {
  ProtocolVersion: Number;
  VirtualChainId: Number;
  ContractName: String;
}

interface MethodCall extends Contract {
  MethodName: string;
  Arguments: MethodArgument[];
}

interface SendTransaction extends Contract {
  MethodName: string;
  Arguments: MethodArgument[];
}

interface TxReceipt {
  Txhash: string;
  ExecutionResult: string;
  OutputArguments: MethodArgument[];
}

interface SendTransactionResult {
  TransactionReceipt: TxReceipt;
  TransactionStatus: number;
  BlockHeight: number;
  BlockTimestamt: number;
}

function generateAddress(username: string): Account {
  const output = shell.exec(`${ORBS_JSON_CLIENT_PATH} --generate-test-keys`).stdout.split("\n");

  return { address: output[0], publicKey: output[1], privateKey: output[2], username };
}

async function getAccount(username: string): Promise<Account> {
  let account = await loadAccount(username);

  if (!account) {
    account = generateAddress(username);
    await saveAccount(account);
  }

  return Promise.resolve(account);
}

async function matchInput(message: any, condition: RegExp, botUsername: string,
  callback: (clientAccount: Account, botAccount: Account, match: any) => void) {
    const matches = message.text.match(condition);

    if (matches) {
      const [clientAccount, botAccount] = await Promise.all([
        getAccount(message.user), getAccount(botUsername)
      ]);

      callback(clientAccount, botAccount, matches);
    }
}

function mention(account: Account) {
  return `<@${account.username}> ${account.publicKey}`;
}

function base64ToHex(b64input: string) {
  return Buffer.from(b64input, "base64").toString("hex");
}

const redisClient: any = redis.createClient(process.env.REDIS_URL);

async function saveAccount(account: Account) {
  return redisClient.hmsetAsync(account.username, account);
}

async function loadAccount(username: any) {
  return redisClient.hgetallAsync(username);
}

class Client {
  config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async getMyBalance(account: Account): Promise<number> {
    const callMethod: MethodCall = {
      ProtocolVersion: 1,
      VirtualChainId: VIRTUAL_CHAIN_ID,
      ContractName: "BenchmarkToken",
      MethodName: "getBalance",
      Arguments: [{
        Name: "targetAddress",
        Type: 3,
        BytesValue: Buffer.from(account.address, "hex").toString("base64"),
      }]
    };

    const output = shell.exec(`${ORBS_JSON_CLIENT_PATH} --call-method '${JSON.stringify(callMethod)}' --public-key ${account.publicKey}`).stdout.split("\n")[0];

    const balance = Number(JSON.parse(output).OutputArguments[0].Uint64Value);
    return balance;
  }

  async transfer(from: Account, to: Account, amount: Number): Promise<SendTransactionResult> {
    const sendTransaction: SendTransaction = {
      ProtocolVersion: 1,
      VirtualChainId: VIRTUAL_CHAIN_ID,
      ContractName: "BenchmarkToken",
      MethodName: "transfer",
      Arguments: [
        {
          Name: "amount",
          Type: 1,
          Uint64Value: amount,
        },
        {
          Name: "targetAddress",
          Type: 3,
          BytesValue: Buffer.from(to.address, "hex").toString("base64"),
        }
      ]
    };

    console.log(`${ORBS_JSON_CLIENT_PATH} --send-transaction '${JSON.stringify(sendTransaction)}' --public-key ${from.publicKey} --private-key ${from.privateKey}`);

    const output = shell.exec(`${ORBS_JSON_CLIENT_PATH} --send-transaction '${JSON.stringify(sendTransaction)}' --public-key ${from.publicKey} --private-key ${from.privateKey}`).stdout.split("\n")[0];

    const result = JSON.parse(output);
    return result;
  }
}

const orbsClient = new Client(config);

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
  getAccount(message.user).then(console.log);

  try {
    matchInput(message, /^get my address$/i, BOT_USER_ID, async (client, bot, match) => {
      rtm.sendMessage(mention(client), message.channel);
    });

    matchInput(message, /^get my balance$/i, BOT_USER_ID, async (client, bot, match) => {
      const clientBalance = await orbsClient.getMyBalance(client);
      rtm.sendMessage(`${mention(client)} has ${clientBalance} magic internet money`, message.channel);
    });

    matchInput(message, /I opened a pull request/i, BOT_USER_ID, async (client, bot, match) => {
      rtm.sendMessage(`Transfering ${PULL_REQUEST_AWARD} to ${mention(client)}`, message.channel);
      const result = await orbsClient.transfer(bot, client, PULL_REQUEST_AWARD);

      rtm.sendMessage(`Transaction ${base64ToHex(result.TransactionReceipt.Txhash)} committed to block ${result.BlockHeight}`, message.channel);

      const [ clientBalance, botBalance ] = await Promise.all([orbsClient.getMyBalance(client), orbsClient.getMyBalance(bot)]);
      rtm.sendMessage(`${mention(client)} has ${clientBalance} magic internet money`, message.channel);
      rtm.sendMessage(`${mention(bot)} now has ${botBalance} magic internet money`, message.channel);
    });

    matchInput(message, /[transfer|send] (\d+) to <@(\w+)>/, BOT_USER_ID, async (client, bot, match) => {
      const amount = Number(match[1]);
      const to = match[2];

      const receiver = await getAccount(to);
      rtm.sendMessage(`Transfering ${amount} from ${mention(client)} to ${mention(receiver)}`, message.channel);

      const result = await orbsClient.transfer(client, receiver, amount);

      rtm.sendMessage(`Transaction ${base64ToHex(result.TransactionReceipt.Txhash)} committed to block ${result.BlockHeight}`, message.channel);

      const [ clientBalance, receiverBalance ] = await Promise.all([orbsClient.getMyBalance(client), orbsClient.getMyBalance(receiver)]);
      rtm.sendMessage(`${mention(client)} now has ${clientBalance} magic internet money`, message.channel);
      rtm.sendMessage(`${mention(receiver)} now has ${receiverBalance} magic internet money`, message.channel);
    });
  } catch (e) {
    console.log(`Error occurred: ${e}`);
  }

});
