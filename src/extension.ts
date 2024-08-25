import * as vscode from 'vscode';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

const loginUrl = 'http://yapi.gydev.cn/login';
declare const localStorage: any;

// 文件路径
const cookiesFilePath = path.resolve(__dirname, 'cookies.json');
const localStorageFilePath = path.resolve(__dirname, 'localStorage.json');

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('extension.apiToTs', async (URI) => {
		useExtension(URI).then(() => {
		}).catch(err => {
			vscode.window.showErrorMessage(err);
			new Error(err);
		});
  });

  context.subscriptions.push(disposable);
}

export function deactivate() { }

const useExtension =async (URI:any) => {
	try {
		const browser = await puppeteer.launch({ headless: true });
		const page = await browser.newPage();
		let isLogin=false
		  // 检查 token 是否有效
		if (fs.existsSync(cookiesFilePath) && fs.existsSync(localStorageFilePath)) {

			const cookies = JSON.parse(fs.readFileSync(cookiesFilePath, 'utf8'));
			await page.setCookie(...cookies);

			const localStorageData = fs.readFileSync(localStorageFilePath, 'utf8');

			await page.evaluate(data => {
				const localStorageItems = JSON.parse(data);
				for (const key in localStorageItems) {
					localStorage.setItem(key, localStorageItems[key]);
				}
			}, localStorageData);
		} else {
			isLogin = await loginModule(page);
		}
		const isTokenValid = await checkTokenValidity(page);
		if (!isTokenValid && !isLogin) {
			await loginModule(page);
		}
		const platform = await vscode.window.showQuickPick(['微信小程序', 'ccs', 'finclip'], {
			placeHolder: '必须选择一个平台'
		});
		const targetUrl = await vscode.window.showInputBox({
			prompt: 'Enter URL to scrape',
			placeHolder: 'https://example.com',
			ignoreFocusOut:true,
		})
		if (!targetUrl) {
			vscode.window.showErrorMessage('请输入一个接口地址');
			return;
		}
		await page.goto(targetUrl, { waitUntil: 'networkidle2' });

		const clickableElements = await page.$$('.ant-table-row-collapsed');
		for (const element of clickableElements) {
			await element.click();
		}

		const clickableElements2 = await page.$$('.ant-table-row-collapsed');
		for (const element of clickableElements2) {
			await element.click();
		}

		const content = await page.content();

		const $ = cheerio.load(content);
		// ----------------------------获取接口路径---------------------------->
		let method = '';
		let urlPath = '';
		$('.colKey:contains("接口路径")').next('.colValue').find(".colValue").each((index: number, element: any) => {
			if (index === 0) {
				method=$(element).text().trim()
			}
			if (index === 1) {
				urlPath=$(element).text().trim()
			}
		})
		const apiNote = $('.colKey:contains("接口名称")').next('.colName').find("span").text().trim();
		const urlPathArr = urlPath.split('/');
		let queryTypeName = '';
		let requestTypeName = '';
		let functionName = '';
		let functionUrl = '';
		const lastElement = urlPathArr[urlPathArr.length-1];
		if (lastElement.length < 8) {
			const secondLastElement = urlPathArr[urlPathArr.length - 2];
			queryTypeName = toPascalCase(`T_${secondLastElement}_${lastElement}_Query`);
			requestTypeName = toPascalCase(`T_${secondLastElement}_${lastElement}_Response`);
			functionName = toLowerCamelCase(`get_${secondLastElement}_${lastElement}_Api`);
			functionUrl = toLowerCamelCase(`get_${secondLastElement}_${lastElement}_Url`);
		} else {
			queryTypeName = toPascalCase(`T_${lastElement}_Query`);
			requestTypeName = toPascalCase(`T_${lastElement}_Response`);
			functionName = toLowerCamelCase(`get_${lastElement}_Api`);
			functionUrl = toLowerCamelCase(`get_${lastElement}_Url`);
		}
		//----------------------------获取headers请求参数--------------------------->
		let contentType = '';
		$('.col-title:contains("Headers")').next('.ant-table-wrapper').find(".ant-table-row-level-0").each((index0:number, element:any) => {
			$(element).find('td').each((index, td) => {
				if (index0===0 && index === 1) {
					contentType=$(td).text().trim()
				}
			});
    });
		// ----------------------------请求参数类型解析 ---------------------------->
		// 递归解析表格行数据
		const parseRows = (rows:any, level:number) => {
			let fields:any[] = [];
			rows.each((index:number, element:any) => {
				let itemObj = new Map();
				$(element).find('td').each((index, td) => {
					if (index === 0) {
						itemObj.set('name', $(td).text().trim());
					}
					if (index === 1) {
						itemObj.set('type', $(td).text().trim());
					}
					if (index === 3 || index === 4) {
						itemObj.set('remark', $(td).text().trim());
					}
				});

				// 递归处理子级
				let nextRows:any[] = [];
				$(element).nextAll().each((i, sibling) => {
					if ($(sibling).hasClass(`ant-table-row-level-${level + 1}`)) {
						nextRows.push(sibling);
					} else if ($(sibling).hasClass(`ant-table-row-level-${level}`)) {
						return false; // 遇到下一个同级别的元素时停止
					}
				});

				if (nextRows.length > 0) {
					itemObj.set('type', parseRows($(nextRows), level + 1));
				}

				fields.push(itemObj);
			});

			return fields;
		};

		const apiFields = parseRows($('.col-title:contains("Body"), .col-title:contains("Query")').next('.ant-table-wrapper').find(".ant-table-row-level-0"), 0);

		// TypeScript 类型定义字符串
		let typeDefinition = `interface ${queryTypeName} {\n`;
		apiFields.forEach(field => {
			if (Array.isArray(field.get('type'))) {
				typeDefinition += `  /**\n   * ${field.get('remark')}\n*/\n  ${field.get('name')}: {\n`;
				field.get('type').forEach((subField: { get: (arg0: string) => string; }) => {
					const tsType2 = subField.get('type').replace('integer', 'number'); // 将 'integer' 替换为 TypeScript 的 'number'
					typeDefinition += `    /**\n     * ${subField.get('remark')}\n     */\n    ${subField.get('name')}: ${tsType2};\n`;
				});
				typeDefinition += `  }[],\n`;
			} else {
				const tsType = field.get('type').replace('integer', 'number'); // 将 'integer' 替换为 TypeScript 的 'number'
				typeDefinition += `  /**\n   * ${field.get('remark')}\n   */\n  ${field.get('name')}: ${tsType};\n`;
			}
		});

		typeDefinition += `}\n`;

		// 2----------------------------返回参数类型解析---------------------------------->
		// 定义一个数组存储所有接口文档信息

		// 查找请求体内容，请求体一般放在data中，所以查找直接从ant-table-row-level-1开始
		let apiResponse = parseRows($('.interface-title:contains("返回数据")').next('.ant-table-wrapper').find(".ant-table-row-level-1"), 1);

		// 判断是否是list接口,list接口的话层级从ant-table-row-level-2开始
		if (apiResponse.filter(item => item.get('name') === 'pageSize' || item.get('name') === 'currentPage').length) {
			apiResponse = parseRows($('.interface-title:contains("返回数据")').next('.ant-table-wrapper').find(".ant-table-row-level-2"), 2);
		}

		let typeRequestDefinition = `interface ${requestTypeName} {\n`;
		// 解析返回数据成ts
		apiResponse.forEach(field => {
			if (Array.isArray(field.get('type'))) {
				typeRequestDefinition += `  /**\n   * ${field.get('remark')}\n*/\n  ${field.get('name')}: {\n`;
				field.get('type').forEach((subField:any) => {
					const tsType2 = subField.get('type').replace('integer', 'number'); // 将 'integer' 替换为 TypeScript 的 'number'
					typeRequestDefinition += `    /**\n     * ${subField.get('remark')}\n     */\n    ${subField.get('name')}: ${tsType2};\n`;
				});
				typeRequestDefinition += `  }[],\n`;
			} else {
				const tsType = field.get('type').replace('integer', 'number'); // 将 'integer' 替换为 TypeScript 的 'number'
				typeRequestDefinition += `  /**\n   * ${field.get('remark')}\n   */\n  ${field.get('name')}: ${tsType};\n`;
			}
		});
		typeRequestDefinition += `}\n`;

		// 请求url
		let apiUrl = `// ${apiNote}\n `;
		apiUrl += `const ${functionUrl} = "${urlPath}"`;

	 // ccs平台请求接口模版
		let api = '';
		if (platform === '微信小程序') {
			const functionType = toPascalCase(`T_${queryTypeName}_FunctionType`);
			api = `/**\n   * ${apiNote}\n   */\n `;
			api += `type ${functionType} = (params: ${queryTypeName}) => Promise<IBaseInterface<${requestTypeName}>>;\n`
			api += `const ${functionName}: TRequestConfirmReceive = loadingFn(async ( params ) =>{\n`
			api += `  const { data } = await wxRequest(${functionUrl}, '${method}', params);\n`
			api += `  return data;\n`
			api +=`}, { errTips: false });`
		}
		if (platform==='ccs') {
			api= `/**\n   * ${apiNote}\n   */\n `;
			api += `const ${functionName} = async (data: ${queryTypeName}) => {\n`
			api += `  return await request.${method.toLowerCase()}<${requestTypeName}>(${functionUrl}, {\n`
			api += `  params: {...data},\n`
			api +=  contentType.indexOf('x-www-form-urlencoded')>0?`contentType: 'application/x-www-form-urlencoded;charset=UTF-8',\n`:''
			api +=`   });\n}`
		}
		if (platform==='finclip') {
			api= `/**\n   * ${apiNote}\n   */\n `;
			api += `const ${functionName} = (params: ${queryTypeName}): Promise<Response<${requestTypeName}>> => {\n`
			api += `  return ${method}(${functionUrl}, {\n`
			api += `  data: { ...params },\n`
			api += `  isShowLoading: false,\n`
			api +=  contentType.indexOf('x-www-form-urlencoded')>0?`  header: {'content-type': 'application/x-www-form-urlencoded',},\n`:''
			api +=`   });\n}`
		}

		const filePath = `${URI.fsPath}/type.ts`;
		if (fs.existsSync(filePath)) {
			vscode.window.showInformationMessage(`已写入type.ts文件`);
			fs.appendFileSync( filePath, `${typeDefinition}\n${typeRequestDefinition}\n${apiUrl}\n${api}`, 'utf8');
		} else {
			vscode.window.showInformationMessage(`新建文件type.ts文件`);
			fs.writeFileSync( filePath, `${typeDefinition}\n${typeRequestDefinition}\n${apiUrl}\n${api}`);
		}
		await browser.close();
	} catch (error) {
		console.error(error);
	}
}

function toPascalCase(str:string) {
  return str
    .split(/[\s_-]+/)  // 按空格、下划线和连字符拆分
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())  // 每个单词首字母大写，其余小写
    .join('');  // 合并成一个字符串
}

function toLowerCamelCase(str:string) {
  return str.replace(/[-_\s]+(.)?/g, (match, group1) => group1 ? group1.toUpperCase() : '');
}

async function checkTokenValidity(page: any) {
  // 检查页面中特定的用户菜单元素
	await page.goto('http://yapi.gydev.cn/project/90/interface/api', { waitUntil: 'networkidle2' });
	const userMenu = await page.$('.left-menu'); // 替换为实际的选择器
  return userMenu !== null;
}

async function loginModule(page: any): Promise<boolean> {
	let isLogin=false
	const email = await vscode.window.showInputBox({
		prompt: 'Enter account to scrape',
		placeHolder: '请输入yapi账号',
		ignoreFocusOut:true,
	})

	const password = await vscode.window.showInputBox({
		prompt: 'Enter account to scrape',
		placeHolder: '请输入yapi密码',
		password: true,
		ignoreFocusOut:true,
	})
	if (!email || !password) {
		vscode.window.showErrorMessage('请输入账号密码');
		return isLogin;
	}

	await page.goto(loginUrl, { waitUntil: 'networkidle2' });

	await page.type('#email', email);
	await page.type('#password', password);
	await Promise.all([
		page.click('.login-form-button'),
		page.waitForNavigation({ waitUntil: 'networkidle2' }),
	]).then(() => {
		isLogin=true
	}).catch(err => {
		vscode.window.showErrorMessage('登录失败');
		return;
	});
	const cookies = await page.cookies();
	const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));
	fs.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2));
	fs.writeFileSync(localStorageFilePath, localStorageData);
	return isLogin
}