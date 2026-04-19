"use strict";

require("dotenv").config();

const TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.APPLICATION_ID;

if (!TOKEN || !APP_ID) {
  console.error("Missing DISCORD_TOKEN or APPLICATION_ID");
  process.exit(1);
}

console.log("TOKEN present:", Boolean(TOKEN));
console.log("APP ID:", APP_ID);

const RANGE_CHOICES = [
  { name: "7 days", value: "7" },
  { name: "20 days", value: "20" },
  { name: "30 days", value: "30" },
  { name: "All time", value: "all" },
];

const commands = [
  { name: "help", description: "View HUMN commands and setup help" },
  { name: "setup", description: "Check your full HUMN setup status" },
  { name: "create-group", description: "Create your private group", options: [{ type: 3, name: "name", description: "Group name", required: true }] },
  { name: "join", description: "Join a group with a code", options: [{ type: 3, name: "code", description: "Group join code", required: true }] },
  { name: "leave-group", description: "Leave your current group" },
  { name: "disconnect-email", description: "Disconnect your current Gmail or Yahoo account" },
  { name: "set-webhook", description: "Save the Discord webhook for your group", options: [{ type: 3, name: "url", description: "Discord webhook URL", required: true }] },
  { name: "connect-gmail", description: "Get your Gmail connection link" },
  { name: "connect-yahoo", description: "Get Yahoo setup instructions" },
  { name: "save-yahoo", description: "Save your Yahoo email and app password", options: [
    { type: 3, name: "email", description: "Your Yahoo email", required: true },
    { type: 3, name: "app_password", description: "Yahoo app password", required: true },
  ]},
  { name: "status", description: "Check your email connection status" },
  { name: "test-event", description: "Send a test checkout event" },
  { name: "stats", description: "View group analytics", options: [
    { type: 3, name: "range", description: "Select time range", required: true, choices: RANGE_CHOICES },
    { type: 3, name: "retailer", description: "Optional retailer filter", required: false },
  ]},
  { name: "leaderboard", description: "View top users by checkouts", options: [
    { type: 3, name: "range", description: "Select time range", required: true, choices: RANGE_CHOICES },
    { type: 3, name: "retailer", description: "Optional retailer filter", required: false },
  ]},
  { name: "recent-checkouts", description: "View recent checkout activity", options: [
    { type: 4, name: "limit", description: "Number to show", required: false, min_value: 1, max_value: 10 },
    { type: 3, name: "retailer", description: "Optional retailer filter", required: false },
  ]},
  { name: "user-stats", description: "View stats for a user in your group", options: [
    { type: 3, name: "range", description: "Select time range", required: true, choices: RANGE_CHOICES },
    { type: 6, name: "user", description: "User to view stats for", required: false },
    { type: 3, name: "retailer", description: "Optional retailer filter", required: false },
  ]},
  { name: "top-products", description: "View the most purchased products in your group", options: [
    { type: 3, name: "range", description: "Select time range", required: true, choices: RANGE_CHOICES },
    { type: 3, name: "retailer", description: "Optional retailer filter", required: false },
    { type: 4, name: "limit", description: "Number to show", required: false, min_value: 1, max_value: 10 },
  ]},
  { name: "trend-analytics", description: "View checkout trend analytics by day", options: [
    { type: 3, name: "range", description: "Select time range", required: true, choices: RANGE_CHOICES },
    { type: 3, name: "retailer", description: "Optional retailer filter", required: false },
  ]},
  { name: "subscribe", description: "Subscribe to HUMN — $350 setup + $50/month" },
  { name: "subscription", description: "Check your group subscription status" },
  { name: "beta-activate", description: "Grant beta access to a group (bot owner only)", options: [
    { type: 3, name: "group_id", description: "Group ID to activate", required: true },
    { type: 6, name: "user", description: "Group owner Discord user", required: true },
  ]},
];

console.log(`Registering ${commands.length} commands via fetch...`);

fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: "PUT",
  headers: {
    "Authorization": `Bot ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
})
  .then(async (res) => {
    const text = await res.text();
    if (res.ok) {
      console.log("Commands registered successfully!");
    } else {
      console.error("Failed:", res.status, text);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fetch error:", err.message);
    process.exit(1);
  });
