const axios = require('axios');
const https = require('https');
const ora = require('ora');
const Inquirer = require('inquirer');
const chalk = require('chalk');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
let ncp = require('ncp');
const removeDir = require('../utils/removeDir');
let downloadGitRepo = require('download-git-repo');
const MetalSmith = require('metalsmith');//遍历文件夹,找需不需要渲染
//consolidate 统一了所有的模板引擎
let { render } = require('consolidate').ejs;
//可以把异步的API转化为Promise
downloadGitRepo = promisify(downloadGitRepo);
ncp = promisify(ncp);
render = promisify(render);

const { downloadDirectory } = require('./constants');


// create所有的逻辑
// create是创建项目
// 拉取远程项目列表，让用户选择要创建哪个项目 Projectname
// 显示该项目的版本号，让用户选择创建哪个版本
// 可能需要用户输入某些配置，来渲染该项目模板

// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const agent = new https.Agent({  
  rejectUnauthorized: false
});

// https://api.github.com/orgs/zhu-cli/repos 获取组织下的仓库
const fetchRepoList = async () => {
  const { data } = await axios.get('https://api.github.com/orgs/td-cli/repos', { httpsAgent: agent }).catch((err) => {
    console.log(err);
  });
  return data;
}

//抓取选择的项目tag  https://api.github.com/repos/zhu-cli/vue-simple-template/tags
const fetchTags = async (repo) => {
  const { data } = await axios.get(`https://api.github.com/repos/td-cli/${repo}/tags`, { httpsAgent: agent }).catch((err) => {
    console.log(err);
  });
  return data;
}

//封装loading效果
const waitFnLoading = (fn, message) => async (...args) => {
  const spinner = ora(message);
  spinner.start();
  let repos = await fn(...args);
  spinner.succeed();
  return repos;
}

//下载模板的方法
const download = async (repo, tag) => {
  let api = `td-cli/${repo}`;
  if (tag) {
    api += `#${tag}`;
  }
  const dest = `${downloadDirectory}/${repo}`;
  await downloadGitRepo(api, dest, {agent: {https: agent}}).catch((err) => {
    console.log(err);
  });
  return dest;//返回最终的下载目录
}

// 项目初始化成功
const initSuccess = (projectName) => {
  console.log(`\n ${chalk.cyan('Project Init Success!')}`);
  console.log(`\n ${chalk.cyan('cd')} ${chalk.cyan(projectName)}`);
  console.log(`\n ${chalk.cyan('npm install')}`);
  console.log(`\n ${chalk.cyan('npm run serve')}`);
}

module.exports = async (projectName) => {
  //0) 先看当前目录下是否已存在要创建的项目目录，如有，则询问是否覆盖，覆盖则删除之前目录，创建新项目，不覆盖则中断操作
  const targetDir = path.join(process.cwd(), projectName);
  if(fs.existsSync(targetDir)) {
    const { action } = await Inquirer.prompt({
      name: 'action',
      type: 'confirm',
      message: `Target directory ${chalk.cyan(targetDir)} already exists,overwrite?`,
    });
    if(action) {
      console.log(`\nRemoving ${chalk.cyan(targetDir)}...`);
      removeDir(targetDir);
    }else {
      return;
    }
  }

  //1) 获取项目所有模板
  let repos = await waitFnLoading(fetchRepoList, 'fetching templete ...')();
  repos = repos.map(item => item.name);

  //获取之前 显示loading 关闭loading   使用ora
  //选择模板 使用inquirer
  const { repo } = await Inquirer.prompt({
    name: 'repo',
    type: 'list',
    message: 'please choice a templete for create project',
    choices: repos
  });

  //2)通过当前选择的项目 拉取对应的版本
  //获取对应的版本号 https://api.github.com/repos/zhu-cli/vue-simple-template/tags
  let tags = await waitFnLoading(fetchTags, 'fetching tags ...')(repo);
  tags = tags.map(item => item.name);

  const { tag } = await Inquirer.prompt({
    name: 'tag',
    type: 'list',
    message: 'please choice a tag for create project',
    choices: tags
  });

  //3)把模板放到一个临时目录，以备后期使用
  const result = await waitFnLoading(download, 'download template ...')(repo, tag);//下载模板 使用 download-git-repo
  //4)拷贝操作
  //拷贝是用包 ncp
  //简单版： 拿到下载目录，直接拷贝到当前执行的目录即可
  //把template 下的文件拷贝到 当前执行命令的文件下，文件名即项目名为peojectName
  //这个目录 项目名称是否已存在，如果存在则提示当前已存在
  //如果不存在ask.js，则为简单模板，否则为负责模板

  if (!fs.existsSync(path.join(result, 'ask.js'))) {
    await ncp(result, path.resolve(projectName)).catch((err) => {
      console.log(err)
    });
    initSuccess(projectName);
  } else {
    //复杂版： 需要对模板进行渲染，再进行拷贝
    //把git上的项目下载下来，如果有ask.js文件，则是一个复杂模板,需要用户进行选择，然后编译模板
    //metalsmith  只要是模板编译，都是需要这个模块
    await new Promise((resolve, reject) => {
      MetalSmith(__dirname)//如果传入路径，默认会遍历查找当前路径下的src文件夹
        .source(result)//重置遍历路径
        .destination(path.resolve(projectName))
        .use(async (files, metal, done) => {
          //1)用户填写信息
          const args = require(path.join(result, 'ask.js'));
          const anwser = await Inquirer.prompt(args);
          const meta = metal.metadata();
          Object.assign(meta, anwser);
          delete files['ask.js'];
          done();
        })
        .use((files, metal, done) => {
          //2)用用户填写的信息去渲染
          //根据用户的输入，下载模板
          const anwser = metal.metadata();
          //要处理 <% 
          Reflect.ownKeys(files).forEach(async (file) => {
            if (file.includes('js') || file.includes('json')) {
              let content = files[file].contents.toString();
              if (content.includes('<%')) {
                content = await render(content, anwser);
                files[file].contents = Buffer.from(content);
              }
            }
          });
          done();
        })
        .build((err) => {
          if (err) {
            reject();
          } else {
            resolve();
            initSuccess(projectName);
          }
        });
    })
  }
};