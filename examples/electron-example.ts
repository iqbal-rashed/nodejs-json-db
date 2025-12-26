/**
 * Electron Integration Example
 *
 * This example shows how to use nodejs-json-db in an Electron application.
 * It demonstrates proper data directory setup using Electron's app.getPath().
 *
 * In a real Electron app, you would use this in your main process.
 */

// In a real Electron app, you would import these:
// import { app } from 'electron';
// import path from 'path';
import { JsonDB, Document } from '../src';
import * as path from 'path';
import * as os from 'os';

// Simulating Electron's app.getPath('userData')
// In real Electron: const userDataPath = app.getPath('userData');
const userDataPath = path.join(os.homedir(), '.my-electron-app');

interface AppSettings extends Document {
  _id: string;
  key: string;
  value: unknown;
}

interface Task extends Document {
  _id: string;
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
}

/**
 * Database service for Electron apps
 */
class DatabaseService {
  private db: JsonDB;
  private initialized = false;

  constructor() {
    // Store data in the user's app data directory
    this.db = new JsonDB({
      dataDir: path.join(userDataPath, 'database'),
      prettyPrint: true,
      autoSave: true,
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.db.connect();
    this.initialized = true;
    console.log('Database initialized at:', this.db.getDataDir());
  }

  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.db.close();
    this.initialized = false;
  }

  // Settings API
  async getSetting<T>(key: string): Promise<T | null> {
    const settings = this.db.collection<AppSettings>('settings');
    const setting = await settings.findOne({ key });
    return setting ? (setting.value as T) : null;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const settings = this.db.collection<AppSettings>('settings');
    const existing = await settings.findOne({ key });

    if (existing) {
      await settings.updateById(existing._id, { $set: { value } });
    } else {
      await settings.insert({ key, value });
    }
  }

  // Tasks API
  get tasks() {
    return this.db.collection<Task>('tasks');
  }
}

// Example usage simulating an Electron app
async function main() {
  console.log('=== Electron Integration Example ===\n');
  console.log('User data path:', userDataPath);

  const database = new DatabaseService();
  await database.init();

  // Settings example
  console.log('\n--- App Settings ---');

  await database.setSetting('theme', 'dark');
  await database.setSetting('language', 'en');
  await database.setSetting('notifications', { email: true, push: false });

  const theme = await database.getSetting<string>('theme');
  console.log('Current theme:', theme);

  const notifications = await database.getSetting<{ email: boolean; push: boolean }>('notifications');
  console.log('Notifications settings:', notifications);

  // Tasks example
  console.log('\n--- Task Management ---');

  // Clear existing tasks for demo
  await database.tasks.clear();

  // Add some tasks
  await database.tasks.insertMany([
    { title: 'Review pull requests', completed: false, priority: 'high' },
    { title: 'Update documentation', completed: false, priority: 'medium', dueDate: '2024-01-15' },
    { title: 'Fix bug #123', completed: true, priority: 'high' },
    { title: 'Team meeting', completed: false, priority: 'low', dueDate: '2024-01-10' },
  ]);

  // Get pending high-priority tasks
  const urgentTasks = await database.tasks.find(
    { completed: false, priority: 'high' },
    { sort: { title: 1 } }
  );
  console.log(
    'Urgent tasks:',
    urgentTasks.map((t) => t.title)
  );

  // Get tasks with due dates
  const scheduledTasks = await database.tasks.find(
    { dueDate: { $exists: true } },
    { sort: { dueDate: 1 } }
  );
  console.log(
    'Scheduled tasks:',
    scheduledTasks.map((t) => `${t.title} (${t.dueDate})`)
  );

  // Complete a task
  await database.tasks.updateOne({ title: 'Review pull requests' }, { $set: { completed: true } });

  // Count completed vs pending
  const completed = await database.tasks.count({ completed: true });
  const pending = await database.tasks.count({ completed: false });
  console.log(`Task status: ${completed} completed, ${pending} pending`);

  // Cleanup
  await database.close();
  console.log('\nDatabase connection closed');
}

main().catch(console.error);
