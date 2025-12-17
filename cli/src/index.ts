#!/usr/bin/env node
/**
 * PRODUCTION HYBRID IDE CLI - 100% LOCKED
 * Removed: local .ai-memory.json (KV is source of truth)
 * Removed: redundant memory concepts
 * Enforced: explicit confirmation, no background tasks
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const program = new Command();
const configDir = path.join(os.homedir(), '.hybrid-ide');
const configFile = path.join(configDir, 'config.json');

interface Config {
  workerUrl: string;
  projectId: string;
  aliases?: Record<string, string>;
}

let config: Config = { workerUrl: '', projectId: 'default' };

// Load config
async function loadConfig() {
  try {
    const data = await fs.readFile(configFile, 'utf-8');
    config = JSON.parse(data);
  } catch {
    await fs.mkdir(configDir, { recursive: true });
    await saveConfig();
  }
}

async function saveConfig() {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
}

// API client
async function callAPI(endpoint: string, data: any): Promise<any> {
  if (!config.workerUrl) {
    throw new Error('Worker URL not configured. Run: ide init');
  }

  const res = await fetch(`${config.workerUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, projectId: config.projectId })
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API error (${res.status}): ${error}`);
  }

  return res;
}

// Commands
program
  .name('ide')
  .description('Hybrid IDE CLI - Production ($0/month)')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize IDE configuration')
  .action(async () => {
    console.log(chalk.cyan('🚀 Production Hybrid IDE Setup\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'workerUrl',
        message: 'Worker URL:',
        validate: (i: string) => i.length > 0 || 'Worker URL required'
      },
      {
        type: 'input',
        name: 'projectId',
        message: 'Project ID:',
        default: 'default'
      }
    ]);

    config = {
      workerUrl: answers.workerUrl.replace(/\/$/, ''),
      projectId: answers.projectId,
      aliases: {}
    };

    await saveConfig();

    console.log(chalk.green('\n✅ Configuration saved!'));
    console.log(chalk.gray(`\nConfig file: ${configFile}`));
    console.log(chalk.cyan('\nNext: ide doctor'));
  });

program
  .command('complete <file>')
  .alias('c')
  .description('AI-complete code in file')
  .option('-i, --interactive', 'Interactive mode with preview')
  .action(async (file, options) => {
    try {
      if (!await fileExists(file)) {
        console.log(chalk.red(`❌ File not found: ${file}`));
        return;
      }

      const spinner = ora(`Reading ${file}...`).start();
      const content = await fs.readFile(file, 'utf-8');
      const language = detectLanguage(file);
      spinner.succeed(`Read ${file} (${language})`);

      const aiSpinner = ora('AI completing code...').start();

      try {
        const response = await callAPI('/api/complete', {
          fileId: file,
          code: content,
          cursor: content.length,
          language
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let result = '', provider = '', cost = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              result = data.token;
              provider = data.provider;
              cost = data.cost;
            }
          }
        }

        if (result) {
          aiSpinner.succeed(`Completed via ${provider} (cost: $${cost})`);

          console.log(chalk.green('\n✨ AI Completion:\n'));
          console.log(chalk.white(result));

          if (options.interactive || !options.interactive) {
            const { apply } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'apply',
                message: 'Apply this completion to file?',
                default: false
              }
            ]);

            if (apply) {
              await fs.writeFile(file, content + result);
              console.log(chalk.green('\n✅ Completion applied to file'));
            } else {
              console.log(chalk.yellow('\n⏭️  Completion not applied'));
            }
          }
        } else {
          aiSpinner.fail('No completion generated');
        }
      } catch (error: any) {
        aiSpinner.fail('AI completion failed');

        if (error.message.includes('quota exceeded')) {
          console.log(chalk.yellow('\n⚠️  Daily KV quota exceeded (1000 writes/day)'));
          console.log(chalk.cyan('Solutions:'));
          console.log('  1. Wait 24 hours for quota reset');
          console.log('  2. Use Ollama for unlimited local AI (ide doctor)');
        } else {
          console.log(chalk.red(`\nError: ${error.message}`));
        }
      }
    } catch (error: any) {
      console.log(chalk.red(`❌ Error: ${error.message}`));
    }
  });

program
  .command('explain <file>')
  .alias('e')
  .description('Explain code in file')
  .option('-l, --lines <range>', 'Line range (e.g., 10-20)')
  .action(async (file, options) => {
    try {
      if (!await fileExists(file)) {
        console.log(chalk.red(`❌ File not found: ${file}`));
        return;
      }

      const spinner = ora(`Analyzing ${file}...`).start();
      let content = await fs.readFile(file, 'utf-8');

      if (options.lines) {
        const [start, end] = options.lines.split('-').map((n: string) => parseInt(n) - 1);
        const lines = content.split('\n');
        content = lines.slice(Math.max(0, start), end + 1).join('\n');
        spinner.text = `Analyzing lines ${options.lines}...`;
      }

      const language = detectLanguage(file);
      spinner.text = 'Generating explanation...';

      const response = await callAPI('/api/explain', {
        code: content,
        language
      });

      const data = await response.json();

      if (data.explanation) {
        spinner.succeed(`Explained via ${data.provider}`);

        console.log(chalk.cyan('\n💡 Code Explanation:\n'));
        console.log(chalk.white(data.explanation));
      } else {
        spinner.fail('Explanation failed');
      }
    } catch (error: any) {
      console.log(chalk.red(`❌ Error: ${error.message}`));
    }
  });

program
  .command('chat')
  .description('Interactive AI chat (request-scoped, no persistent state)')
  .action(async () => {
    console.clear();
    console.log(chalk.bold.cyan('🤖 Hybrid IDE Chat\n'));
    console.log(chalk.gray('Type your questions. Commands: /quit, /clear, /help\n'));
    console.log(chalk.yellow('Note: History is request-scoped (last 5 messages only)\n'));

    const history: any[] = [];

    while (true) {
      try {
        const { input } = await inquirer.prompt([
          {
            type: 'input',
            name: 'input',
            message: chalk.green('You:'),
            prefix: ''
          }
        ]);

        if (!input) continue;

        if (input === '/quit' || input === '/exit') {
          console.log(chalk.yellow('👋 Goodbye!'));
          break;
        }

        if (input === '/clear') {
          console.clear();
          history.length = 0;
          console.log(chalk.yellow('Chat history cleared.\n'));
          continue;
        }

        if (input === '/help') {
          console.log(chalk.cyan('\nCommands:'));
          console.log('  /quit   - Exit chat');
          console.log('  /clear  - Clear history');
          console.log('  /help   - Show this help\n');
          continue;
        }

        history.push({ role: 'user', content: input });

        console.log(chalk.cyan('\nAI: '));
        const spinner = ora({ text: '', spinner: 'dots' }).start();

        try {
          const response = await callAPI('/api/chat', {
            message: input,
            history: history.slice(-5) // Only send last 5 messages
          });

          spinner.stop();

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let result = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6));
                result = data.token;
              }
            }
          }

          console.log(chalk.white(result));
          console.log();

          history.push({ role: 'assistant', content: result });
        } catch (error: any) {
          spinner.stop();
          console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
        }
      } catch {
        console.log(chalk.yellow('\n👋 Goodbye!'));
        break;
      }
    }
  });

program
  .command('status')
  .alias('s')
  .description('Show IDE status and quota')
  .option('-j, --json', 'JSON output')
  .action(async (options) => {
    try {
      if (!options.json) {
        console.log(chalk.bold.cyan('📊 Hybrid IDE Status\n'));
      }

      const response = await fetch(`${config.workerUrl}/api/health`);
      const health = await response.json();

      if (options.json) {
        console.log(JSON.stringify(health, null, 2));
      } else {
        console.log(chalk.bold('🤖 AI Providers:'));
        health.providers.forEach((p: any) => {
          const icon = p.status === 'available' ? '✅' :
            p.status === 'circuit_open' ? '⚠️ ' : '❌';
          const free = p.free ? chalk.green('(FREE)') : chalk.yellow('(PAID)');
          console.log(`  ${icon} ${p.name} - ${p.tier} ${free} - ${p.status}`);
        });

        console.log(chalk.bold('\n📊 Daily KV Quota:'));
        const quotaPercent = health.kvWriteQuota || 0;
        const quotaColor = quotaPercent > 85 ? chalk.red :
          quotaPercent > 70 ? chalk.yellow : chalk.green;
        console.log(`  ${quotaColor(`${quotaPercent}%`)} used (${Math.round(quotaPercent * 10)}/1000 writes)`);

        if (quotaPercent >= 100) {
          console.log(chalk.red('\n  ⚠️  QUOTA EXCEEDED - Switch to Ollama or wait 24h'));
        } else if (quotaPercent > 85) {
          console.log(chalk.yellow('\n  ⚠️  Approaching quota limit - Consider using Ollama'));
        }

        console.log(chalk.bold('\n📁 Current Project:'));
        console.log(`  Project ID: ${config.projectId}`);
        console.log(`  Worker URL: ${config.workerUrl}`);

        console.log(chalk.bold('\n💰 Cost:'));
        console.log('  Monthly: $0 (free tier enforced)');
        console.log('  Savings vs Copilot: $120/year');
      }
    } catch (error: any) {
      console.log(chalk.red(`❌ Error: ${error.message}`));
    }
  });

program
  .command('doctor')
  .description('Run health check and diagnostics')
  .action(async () => {
    console.log(chalk.bold.cyan('🔍 IDE Health Check\n'));

    const checks = [
      {
        name: 'Configuration',
        test: async () => {
          if (!config.workerUrl || config.workerUrl.length === 0) {
            throw new Error('Worker URL not configured');
          }
          return true;
        }
      },
      {
        name: 'Worker Connection',
        test: async () => {
          const res = await fetch(`${config.workerUrl}/api/health`, {
            signal: AbortSignal.timeout(5000)
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return true;
        }
      },
      {
        name: 'KV Quota',
        test: async () => {
          const res = await fetch(`${config.workerUrl}/api/health`);
          const health = await res.json();
          if (health.kvWriteQuota >= 100) {
            throw new Error('Daily quota exceeded');
          }
          return true;
        }
      }
    ];

    for (const { name, test } of checks) {
      const spinner = ora(`Checking ${name}...`).start();
      try {
        await test();
        spinner.succeed(`${name} OK`);
      } catch (error: any) {
        spinner.fail(`${name} FAILED: ${error.message}`);
      }
    }

    console.log(chalk.bold('\n📝 Summary:'));
    console.log('If all checks passed, your IDE is ready!');
    console.log(chalk.gray('\nCommands:'));
    console.log('  ide complete <file>  - AI complete code');
    console.log('  ide explain <file>   - Explain code');
    console.log('  ide chat             - Interactive chat');
    console.log('  ide status           - Check quota & status');
  });

program
  .command('alias <name> [cmd...]')
  .description('Create or show command alias')
  .action(async (name, cmd) => {
    if (!config.aliases) config.aliases = {};

    if (!cmd || cmd.length === 0) {
      // Show alias
      if (config.aliases[name]) {
        console.log(`${chalk.cyan(name)} → ${config.aliases[name]}`);
      } else {
        console.log(chalk.red(`Alias '${name}' not found`));
      }
    } else {
      // Create alias
      config.aliases[name] = cmd.join(' ');
      await saveConfig();
      console.log(chalk.green(`✅ Alias created: ${name} → ${config.aliases[name]}`));
    }
  });

// Utilities
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.html': 'html', '.css': 'css',
    '.json': 'json', '.go': 'go', '.rs': 'rust',
    '.cpp': 'cpp', '.c': 'c', '.java': 'java',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift'
  };
  return langMap[ext] || 'plaintext';
}

// Load config and run
loadConfig().then(() => {
  program.parse();
});
