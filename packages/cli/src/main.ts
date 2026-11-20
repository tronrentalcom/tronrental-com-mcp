#!/usr/bin/env node
import { main, processIo } from "./cli.js";
import { defaultStore } from "./store.js";

process.exitCode = await main(process.argv.slice(2), processIo(defaultStore));
