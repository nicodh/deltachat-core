import chai, { assert, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
import { StdioDeltaChat as DeltaChat } from "../deltachat.js";

import { RpcServerHandle, startServer } from "./test_base.js";

describe("basic tests", () => {
  let serverHandle: RpcServerHandle;
  let dc: DeltaChat;

  before(async () => {
    serverHandle = await startServer();
    dc = new DeltaChat(serverHandle.stdin, serverHandle.stdout, true);
    // dc.on("ALL", (event) => {
    //console.log("event", event);
    // });
  });

  after(async () => {
    dc && dc.close();
    await serverHandle.close();
  });

  it("check email address validity", async () => {
    const validAddresses = [
      "email@example.com",
      "36aa165ae3406424e0c61af17700f397cad3fe8ab83d682d0bddf3338a5dd52e@yggmail@yggmail",
    ];
    const invalidAddresses = ["email@", "example.com", "emai221"];

    expect(
      await Promise.all(
        validAddresses.map((email) => dc.rpc.checkEmailValidity(email)),
      ),
    ).to.not.contain(false);

    expect(
      await Promise.all(
        invalidAddresses.map((email) => dc.rpc.checkEmailValidity(email)),
      ),
    ).to.not.contain(true);
  });

  it("system info", async () => {
    const systemInfo = await dc.rpc.getSystemInfo();
    expect(systemInfo).to.contain.keys([
      "arch",
      "num_cpus",
      "deltachat_core_version",
      "sqlite_version",
    ]);
  });

  describe("account management", () => {
    it("should create account", async () => {
      const res = await dc.rpc.addAccount();
      assert((await dc.rpc.getAllAccountIds()).length === 1);
    });

    it("should remove the account again", async () => {
      await dc.rpc.removeAccount((await dc.rpc.getAllAccountIds())[0]);
      assert((await dc.rpc.getAllAccountIds()).length === 0);
    });

    it("should create multiple accounts", async () => {
      await dc.rpc.addAccount();
      await dc.rpc.addAccount();
      await dc.rpc.addAccount();
      await dc.rpc.addAccount();
      assert((await dc.rpc.getAllAccountIds()).length === 4);
    });
  });

  describe("contact management", function () {
    let accountId: number;
    before(async () => {
      accountId = await dc.rpc.addAccount();
    });
    it("should block and unblock contact", async function () {
      // Cannot send sync messages to self as we do not have a self address.
      await dc.rpc.setConfig(accountId, "sync_msgs", "0");

      const contactId = await dc.rpc.createContact(
        accountId,
        "example@delta.chat",
        null,
      );
      expect((await dc.rpc.getContact(accountId, contactId)).isBlocked).to.be
        .false;
      await dc.rpc.blockContact(accountId, contactId);
      expect((await dc.rpc.getContact(accountId, contactId)).isBlocked).to.be
        .true;
      expect(await dc.rpc.getBlockedContacts(accountId)).to.have.length(1);
      await dc.rpc.unblockContact(accountId, contactId);
      expect((await dc.rpc.getContact(accountId, contactId)).isBlocked).to.be
        .false;
      expect(await dc.rpc.getBlockedContacts(accountId)).to.have.length(0);
    });
  });

  describe("message window", function () {
    let accountId: number;
    let chatId: number;
    let allMessageIds: number[];

    before(async () => {
      accountId = await dc.rpc.addAccount();
      // Device messages are the only ones an unconfigured account can have.
      const messageData = {
        text: null,
        html: null,
        viewtype: null,
        file: null,
        filename: null,
        location: null,
        overrideSenderName: null,
        quotedMessageId: null,
        quotedText: null,
      };
      const messageId = await dc.rpc.addDeviceMessage(accountId, "label0", {
        ...messageData,
        text: "message 0",
      });
      chatId = (await dc.rpc.getMessage(accountId, messageId!)).chatId;
      for (let i = 1; i < 5; i++) {
        await dc.rpc.addDeviceMessage(accountId, `label${i}`, {
          ...messageData,
          text: `message ${i}`,
        });
      }
      // The device chat may contain messages added by the account itself,
      // so compare the windows against the full list rather than against
      // the messages added here.
      allMessageIds = await dc.rpc.getMessageIds(
        accountId,
        chatId,
        false,
        false,
      );
      expect(allMessageIds.length).to.be.greaterThanOrEqual(5);
    });

    it("without anchor ends at the newest message", async () => {
      const window = await dc.rpc.getMessageWindow(
        accountId,
        chatId,
        null,
        2,
        3,
      );
      expect(window.items.map((item) => item.msgId)).to.deep.equal(
        allMessageIds.slice(-3),
      );
      expect(window.hasNewer).to.be.false;
      expect(window.hasOlder).to.be.true;
      expect(window.prevTimestamp).to.be.a("number");
    });

    it("anchored window contains the anchor", async () => {
      const anchor = allMessageIds[allMessageIds.length - 2];
      const window = await dc.rpc.getMessageWindow(
        accountId,
        chatId,
        anchor,
        1,
        1,
      );
      expect(window.items.map((item) => item.msgId)).to.deep.equal(
        allMessageIds.slice(-3),
      );
      expect(window.hasNewer).to.be.false;
      expect(window.items[1].timestamp).to.be.a("number");
    });

    it("whole chat in one window", async () => {
      const window = await dc.rpc.getMessageWindow(
        accountId,
        chatId,
        allMessageIds[0],
        0,
        allMessageIds.length - 1,
      );
      expect(window.items.map((item) => item.msgId)).to.deep.equal(
        allMessageIds,
      );
      expect(window.hasOlder).to.be.false;
      expect(window.hasNewer).to.be.false;
      expect(window.prevTimestamp).to.be.null;
    });

    it("unknown anchor should throw", async () => {
      await expect(dc.rpc.getMessageWindow(accountId, chatId, 999999, 1, 1)).to
        .be.eventually.rejected;
    });
  });

  describe("configuration", function () {
    let accountId: number;
    before(async () => {
      accountId = await dc.rpc.addAccount();
    });

    it("set and retrieve", async function () {
      await dc.rpc.setConfig(accountId, "addr", "valid@email");
      assert((await dc.rpc.getConfig(accountId, "addr")) == "valid@email");
    });
    it("set invalid key should throw", async function () {
      await expect(dc.rpc.setConfig(accountId, "invalid_key", "some value")).to
        .be.eventually.rejected;
    });
    it("get invalid key should throw", async function () {
      await expect(dc.rpc.getConfig(accountId, "invalid_key")).to.be.eventually
        .rejected;
    });
    it("set and retrieve ui.*", async function () {
      await dc.rpc.setConfig(accountId, "ui.chat_bg", "color:red");
      assert((await dc.rpc.getConfig(accountId, "ui.chat_bg")) == "color:red");
    });
    it("set and retrieve (batch)", async function () {
      const config = { addr: "valid@email", mail_pw: "1234" };
      await dc.rpc.batchSetConfig(accountId, config);
      const retrieved = await dc.rpc.batchGetConfig(
        accountId,
        Object.keys(config),
      );
      expect(retrieved).to.deep.equal(config);
    });
    it("set and retrieve ui.* (batch)", async function () {
      const config = {
        "ui.chat_bg": "color:green",
        "ui.enter_key_sends": "true",
      };
      await dc.rpc.batchSetConfig(accountId, config);
      const retrieved = await dc.rpc.batchGetConfig(
        accountId,
        Object.keys(config),
      );
      expect(retrieved).to.deep.equal(config);
    });
    it("set and retrieve mixed(ui and core) (batch)", async function () {
      const config = {
        "ui.chat_bg": "color:yellow",
        "ui.enter_key_sends": "false",
        addr: "valid2@email",
        mail_pw: "123456",
      };
      await dc.rpc.batchSetConfig(accountId, config);
      const retrieved = await dc.rpc.batchGetConfig(
        accountId,
        Object.keys(config),
      );
      expect(retrieved).to.deep.equal(config);
    });
  });
});
