import WSManager from '../src/index';

const manager = new WSManager<unknown[]>('wss://ws.backpack.tf/events');
manager.on('error', (err) => {
  console.error(err);
});

const run = async () => {
  manager.connect();
  while (manager.length == 0) {
    await new Promise((resolve) => setTimeout(() => resolve(undefined), 100));
  }
  console.log(JSON.stringify(manager.getMessages()[0][0], undefined, 2));
  manager.shutdown();
};

run().catch((e) => console.error(e));
