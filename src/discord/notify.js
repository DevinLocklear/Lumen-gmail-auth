"use strict";

/**
 * discord/notify.js
 * Sends DMs to users when their connection breaks or needs attention.
 *
 * The Discord client is injected via setClient() after it's ready.
 * This avoids circular imports between index.js and gmailReader.js.
 *
 * Usage:
 *   // In index.js after client is ready:
 *   const notify = require('./src/discord/notify');
 *   notify.setClient(client);
 *
 *   // In gmailReader.js:
 *   const notify = require('./src/discord/notify');
 *   await notify.sendConnectionDisabled(connection);
 */

const { createLogger } = require("../logger");

const log = createLogger("notify");

let _client = null;

/**
 * Register the Discord client. Call this once in index.js after clientReady.
 */
function setClient(client) {
  _client = client;
  log.info("Discord client registered for notifications");
}

/**
 * Send a DM to a Discord user. Fails silently if:
 * - Client not registered yet
 * - User has DMs disabled
 * - User is not found
 */
async function sendDM(discordUserId, embed) {
  if (!_client) {
    log.warn("DM attempted before client was registered", { discordUserId });
    return false;
  }

  try {
    const user = await _client.users.fetch(discordUserId);
    if (!user) {
      log.warn("User not found for DM", { discordUserId });
      return false;
    }

    await user.send({ embeds: [embed] });
    log.info("DM sent", { discordUserId });
    return true;
  } catch (err) {
    // Common errors: user has DMs disabled, bot not in shared server
    log.warn("DM failed", { discordUserId, error: err.message });
    return false;
  }
}

// ── Notification types ────────────────────────────────────────────────────────

/**
 * Sent when a Yahoo connection is auto-disabled due to auth failure.
 */
async function sendYahooDisconnected(connection) {
  const { EmbedBuilder } = require("discord.js");

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ HUMN — Yahoo Connection Disabled")
    .setDescription(
      `Your Yahoo account **${connection.email}** was disconnected because the app password is no longer valid.\n\n` +
      `This usually happens when:\n` +
      `• You changed your Yahoo password\n` +
      `• Your app password was revoked\n` +
      `• Yahoo expired the app password\n\n` +
      `**To reconnect:**\n` +
      `1. Go to https://login.yahoo.com/account/security\n` +
      `2. Generate a new App Password for **HUMN**\n` +
      `3. Run \`/save-yahoo\` in Discord with your new password`
    )
    .setFooter({
      text: "HUMN • Connection Monitor",
      iconURL: "https://i.imgur.com/ywgtHOK.png",
    });

  return sendDM(connection.discord_user_id, embed);
}

/**
 * Sent when a Gmail token refresh fails and the connection can no longer poll.
 */
async function sendGmailDisconnected(connection) {
  const { EmbedBuilder } = require("discord.js");

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ HUMN — Gmail Connection Issue")
    .setDescription(
      `Your Gmail account **${connection.google_email || connection.email}** needs to be reconnected.\n\n` +
      `This usually happens when:\n` +
      `• You revoked HUMN's access in your Google account\n` +
      `• Your Google session expired\n\n` +
      `**To reconnect:**\n` +
      `Run \`/connect-gmail\` in Discord and follow the link to re-authorize.`
    )
    .setFooter({
      text: "HUMN • Connection Monitor",
      iconURL: "https://i.imgur.com/ywgtHOK.png",
    });

  return sendDM(connection.discord_user_id, embed);
}

/**
 * Sent when a checkout is successfully detected — optional, for testing.
 */
async function sendCheckoutConfirmation(connection, event) {
  const { EmbedBuilder } = require("discord.js");

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ HUMN — Checkout Detected")
    .setDescription(
      `A checkout was detected from your connected inbox.\n\n` +
      `**${event.retailer}** • ${event.product_name}`
    )
    .setFooter({
      text: "HUMN",
      iconURL: "https://i.imgur.com/ywgtHOK.png",
    });

  return sendDM(connection.discord_user_id, embed);
}

module.exports = {
  setClient,
  sendYahooDisconnected,
  sendGmailDisconnected,
  sendCheckoutConfirmation,
};
