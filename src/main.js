const { Command } = require('commander');
const { version } = require('./constants');
const path = require('path');
const program = new Command();
program.version(version).parse(process.argv);

// 配置3个指令命令
const mapActions = {
  create: {
    alias: 'c',
    description: 'create a project',
    examples: [
      'td-cli create <project-name>',
    ],
  },
  config: {
    alias: 'conf',
    description: 'config project variable',
    examples: [
      'td-cli config set <k><v>',
      'td-cli config get <k>',
    ],
  },
  '*': {
    alias: '',
    description: 'command not found',
    examples: [],
  },
};
// 循环创建命令
Reflect.ownKeys(mapActions).forEach((action) => {
  program
    .command(action) // 配置命令的名字
    .alias(mapActions[action].alias) // 命令的别名
    .description(mapActions[action].description) // 命令对应的描述
    .action(() => {
      // 访问不到对应的命令 就打印找不到命令
      if (action === '*') {
        console.log(mapActions[action].description);
      } else {
        //sp-cli create xxx //获取参数数组 [node环境, lx-cli所在目录, create, xxx]
        require(path.resolve(__dirname, action))(...process.argv.slice(3));
      }
    });
});

program.addHelpText('after', () => {
  console.log('\nExamples:');
  Reflect.ownKeys(mapActions).forEach((action) => {
    mapActions[action].examples.forEach((example) => {
      console.log(`${example}`);
    });
  });
});

program.parse();