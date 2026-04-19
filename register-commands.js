"use strict";

/**
 * register-commands.js
 * Run this once to register all slash commands with Discord.
 * Not run on every boot — only when commands change.
 *
 * Usage: node register-commands.js
 */

require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const RANGE_CHOICES = [
  { name: "7 days", value: "7" },
  { name: "20 days", value: "20" },
  { name: "30 days", value: "30" },
  { name: "All time", value: "all" },
];

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("View HUMN commands and setup help"),
  new SlashCommandBuilder().setName("setup").setDescription("Check your full HUMN setup status"),
  new SlashCommandBuilder()
    .setName("create-group").setDescription("Create your private group")
    .addStringOption((o) => o.setName("name").setDescription("Group name").setRequired(true)),
  new SlashCommandBuilder()
    .setName("join").setDescription("Join a group with a code")
    .addStringOption((o) => o.setName("code").setDescription("Group join code").setRequired(true)),
  new SlashCommandBuilder().setName("leave-group").setDescription("Leave your current group"),
  new SlashCommandBuilder().setName("disconnect-email").setDescription("Disconnect your current Gmail or Yahoo account"),
  new SlashCommandBuilder()
    .setName("set-webhook").setDescription("Save the Discord webhook for your group")
    .addStringOption((o) => o.setName("url").setDescription("Discord webhook URL").setRequired(true)),
  new SlashCommandBuilder().setName("connect-gmail").setDescription("Get your Gmail connection link"),
  new SlashCommandBuilder().setName("connect-yahoo").setDescription("Get Yahoo setup instructions"),
  new SlashCommandBuilder()
    .setName("save-yahoo").setDescription("Save your Yahoo email and app password")
    .addStringOption((o) => o.setName("email").setDescription("Your Yahoo email").setRequired(true))
    .addStringOption((o) => o.setName("app_password").setDescription("Yahoo app password").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("Check your email connection status"),
  new SlashCommandBuilder().setName("test-event").setDescription("Send a test checkout event"),
  new SlashCommandBuilder()
    .setName("stats").setDescription("View group analytics")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter").setRequired(false)),
  new SlashCommandBuilder()
    .setName("leaderboard").setDescription("View top users by checkouts")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter").setRequired(false)),
  new SlashCommandBuilder()
    .setName("recent-checkouts").setDescription("View recent checkout activity")
    .addIntegerOption((o) => o.setName("limit").setDescription("Number to show").setRequired(false).setMinValue(1).setMaxValue(10))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter").setRequired(false)),
  new SlashCommandBuilder()
    .setName("user-stats").setDescription("View stats for a user in your group")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addUserOption((o) => o.setName("user").setDescription("User to view stats for").setRequired(false))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter").setRequired(false)),
  new SlashCommandBuilder()
    .setName("top-products").setDescription("View the most purchased products in your group")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter").setRequired(false))
    .addIntegerOption((o) => o.setName("limit").setDescription("Number to show").setRequired(false).setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder()
    .setName("trend-analytics").setDescription("View checkout trend analytics by day")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter").setRequired(false)),
  new SlashCommandBuilder()
    .setName("subscribe").setDescription("Subscribe to HUMN — $350 setup + $50/month"),
  new SlashCommandBuilder()
    .setName("subscription").setDescription("Check your group subscription status"),
  new SlashCommandBuilder()
    .setName("beta-activate").setDescription("Grant beta access to a group (bot owner only)")
    .addStringOption((o) => o.setName("group_id").setDescription("Group ID to activate").setRequired(true))
    .addUserOption((o) => o.setName("user").setDescription("Group owner Discord user").setRequired(true)),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands...`);
    await rest.put(
      Routes.applicationCommands(process.env.APPLICATION_ID),
      { body: commands }
    );
    console.log("✅ Commands registered successfully.");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
  process.exit(0);
})();
