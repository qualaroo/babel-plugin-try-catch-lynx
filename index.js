let t;

module.exports = (babel, opts) => {
    t = babel.types;

    const handlerFunc = require(`${__dirname}/../../${opts.handler}`)();
    const wrapCapture = babel.template(`{
        try {
          FUNC_BODY
        } catch (ERROR_VARIABLE) {
          ${handlerFunc}(ERROR_VARIABLE, (FUNC_NAME + FUNC_LINE));
        }
    }`);

    function astFunc({ whiteList = [] }) {
        return {
          capture: wrapCapture,
          whiteList,
        };
    }

    return {
        visitor: {
            ClassDeclaration(path, _ref = { opts: {} }) {
                if (!path.get('body')) return;

                let bodyPaths = path.get('body').get('body');

                if (!bodyPaths) return;

                if (bodyPaths.length === 0) return;

                bodyPaths.forEach(bodyPath => {

                    if (!bodyPath) return;

                    const bodyNode = bodyPath.node;

                    if (!bodyNode) return;

                    const bodyType = bodyNode.type;
                    const bodyKey = bodyNode.key;

                    if (['ClassMethod', 'ClassProperty'].indexOf(bodyType) === -1) return;

                    let funcname = bodyKey && bodyKey.name;

                    if (!funcname) return;

                    if (bodyType === 'ClassProperty') {
                        bodyPath = bodyPath.get('value');

                        if (!bodyPath) return;

                        if (!bodyPath.node) return;

                        if (!isFuncTypeNode(bodyPath.node.type)) return;
                    }

                    replaceFuncBody(bodyPath, astFunc(_ref.opts));
                });
            },
            Function(path, _ref = { opts: {} }) {

                const parent = path.parent;

                if (!parent) return;

                if (!parent.callee) return;

                const astObj = astFunc(_ref.opts);

                const calleeName = parent.callee.name;
                if (checkAsyncName(calleeName)) return replaceFuncBody(path, astObj);

                const calleeProp = parent.callee.property;
                if (calleeProp && checkAsyncProp(calleeProp.name)) return replaceFuncBody(path, astObj);

                const parentType = parent.type;
                if (parentType === 'ExpressionStatement') return replaceFuncBody(path, astObj);
            },
            CallExpression(path, _ref = { opts: {} }) {
                if (!path.node) return;
                if (!path.node.callee) return;

                const calleeProp = path.node.callee.property;
                const calleeObject = path.node.callee.object;

                if (checkWhitePropAndObject(path.parent)) return;

                if (isFuncTypeNode(path.node.callee.type)) {
                    return replaceFuncBody(path.get('callee'), astFunc(_ref.opts));
                }

                if (!calleeProp) return;

                const args = path.get('arguments');
                if (!path.node.arguments) return;

                const l = path.node.arguments.length;
                if (!l) return;

                // eventListenr
                if (isEventListenr(calleeObject, calleeProp, args)) {
                    replaceFuncBody(args[1], astFunc(_ref.opts));
                    return;
                }

                // setState
                if (['setState'].indexOf(calleeProp.name) > -1) {

                    const funcPath = args[l - 1];

                    if (!funcPath) return;
                    if (!funcPath.node) return;

                    const funcType = funcPath.node.type;

                    if (!isFuncTypeNode(funcType)) return;

                    return replaceFuncBody(funcPath, astFunc(_ref.opts));
                }

            },
            Property(path, _ref = { opts: {} }) {

                const { parent } = path;

                if (!parent) return;
                if (parent.type !== 'ObjectExpression') return;

                const childPath = path.get('value');

                if (!childPath) return;

                const childNode = childPath.node;

                if (!childNode) return;

                if (!isFuncTypeNode(childNode.type)) return;

                replaceFuncBody(childPath, astFunc(_ref.opts));
            },
            AssignmentExpression(path, _ref = { opts: {} }) {
                const { parent } = path;

                if (!parent) return;

                if (parent.type !== 'ExpressionStatement') return;

                if (!path.node) return;

                if (checkWhitePropAndObject(path.node)) return;

                const childPath = path.get('right');

                if (!childPath) return;

                const childNode = childPath.node;

                if (!childNode) return;

                if (!isFuncTypeNode(childNode.type)) return;

                replaceFuncBody(childPath, astFunc(_ref.opts));
            },
            FunctionDeclaration(path, _ref = { opts: {} }) {
                const { parent, node } = path;

                if (!parent) return;
                if (['Program', 'ExportNamedDeclaration', 'ExportDefaultDeclaration'].indexOf(parent.type) < 0) return;
                if (!node.id) return;
                if (!node.id.name) return;

                replaceFuncBody(path, astFunc(_ref.opts));
            },
            VariableDeclarator(path, _ref = { opts: {} }) {
                const { parent } = path;

                if (!parent) return;
                if (parent.type !== 'VariableDeclaration') return;

                const childPath = path.get('init');

                if (!childPath) return;

                const childNode = childPath.node;

                if (!childNode) return;

                if (!isFuncTypeNode(childNode.type)) return;

                replaceFuncBody(childPath, astFunc(_ref.opts));
            },
            BlockStatement(path, _ref = { opts: {} }) {
                const { parent } = path;

                if (!parent) return;

                if (!isFuncTypeNode(parent.type) && parent.type !== 'TryStatement') return;

                const childPaths = path.get('body');

                if (!childPaths.length) return;

                childPaths.forEach(childPath => {

                    if (!childPath) return;

                    const childNode = childPath.node;

                    if (!childNode) return;

                    if (!isFuncTypeNode(childNode.type)) return;

                    replaceFuncBody(childPath, astFunc(_ref.opts));
                });
            },
            ReturnStatement(path, _ref = { opts: {} }) {
                const node = path.node;
                if (!node) return;

                const childPath = path.get('argument');

                if (!childPath) return;

                const childNode = childPath.node;

                if (!childNode) return;

                if (!isFuncTypeNode(childNode.type)) return;

                replaceFuncBody(childPath, astFunc(_ref.opts));
            },
        },
    };
};

function checkAsyncName(params) {
    if (!params) return false;
    return ['setTimeout', 'setInterval', 'Promise'].indexOf(params) > -1
}

function checkAsyncProp(params) {
    if (!params) return false;
    return ['requestAnimationFrame', 'then'].indexOf(params) > -1
}

function replaceFuncBody(path, { capture, whiteList }) {
    const node = path.node;
    if (!node) return;
    if (!node.body) return;

    if (node.body.type !== 'BlockStatement') return;

    let funcBody = node.body.body;
    let astTemplate = capture;

    const len = funcBody.length;
    if (!len) return;

    const firstNode = funcBody[0];
    if (firstNode && firstNode.type === 'TryStatement') return;

    const secondNode = funcBody[1];
    if (secondNode && secondNode.type === 'TryStatement') return;

    let stopFlag = true;

    for (let i = 0; i < len; i++) {
        const currentNode = funcBody[i];

        if (currentNode && currentNode.type === 'ExpressionStatement') {
            const nextNode = currentNode.expression;
            if (nextNode && nextNode.type === 'CallExpression' && nextNode.callee) {
                const nextNodeCalleeType = nextNode.callee.type;
                if (isFuncTypeNode(nextNodeCalleeType) || ['MemberExpression', 'Identifier'].indexOf(nextNodeCalleeType) > -1) {
                    stopFlag = true;
                    continue;
                }
            }
        }

        if (currentNode && (!isFuncTypeNode(currentNode.type) && ['TryStatement', 'ReturnStatement'].indexOf(currentNode.type) === -1)) {
            stopFlag = false;
            break;
        }
    }

    if (stopFlag) return;

    const funcErrorVariable = path.scope.generateUidIdentifier('e');

    const funcId = node.id || node.key;
    let funcLoc = node.loc;
    let funcName = '';

    if (funcId && funcId.type === 'Identifier') {
        funcName = funcId.name || '';
        if (!funcLoc && funcId.loc) funcLoc = funcId.loc;
    }

    if (inWhiteList(funcName, whiteList)) return;

    let funcLine = (funcLoc && funcLoc.start) ? funcLoc.start.line + '' : '';

    funcName = t.StringLiteral(funcName ? (':' + funcName) : funcName);
    funcLine = t.StringLiteral(funcLine ? (':' + funcLine) : funcLine);

    const ast = astTemplate({
        FUNC_BODY: funcBody,
        FUNC_NAME: funcName,
        FUNC_LINE: funcLine,
        ERROR_VARIABLE: funcErrorVariable
    });

    path.get('body').replaceWith(ast);
}

function isFuncTypeNode(type) {
    return type && ['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].indexOf(type) > -1;
}

function isEventListenr(object, property, args) {

    if (!object || !property || !args) return false;

    if (typeof property !== 'object') return false;

    if (['addEventListener', 'removeEventListener'].indexOf(property.name) < 0) return false;

    const len = args.length;

    if (len < 2 && len > 3) return false;

    const func = args[1];

    if (!func) return false;

    const funcNode = func.node;

    if (!funcNode) return false;

    if (!isFuncTypeNode(funcNode.type)) return false;

    return true;
}

function inWhiteList(params, whiteList) {
    let list = [
      'defineProperties',
      '_defineProperty',
      '_classCallCheck',
      '_possibleConstructorReturn',
      '_inherits',
      '_objectWithoutProperties',
      '_createClass',
    ];
    if (Object.prototype.toString.call(whiteList) === '[object Array]') {
        list = list.concat(whiteList);
    }
    return params && list.indexOf(params) > -1;
}

function inWhiteObject(params) {
    if (!params) return false;

    if (typeof params !== 'object') return false;

    const { object, property, name } = params;

    if (name) return ['Object', 'Array', 'Function', 'String'].indexOf(name) > -1;

    if (typeof object === 'object' && typeof property === 'object')
        return (inWhiteObject(object) && inWhiteProp(property));

    return false;
}

function inWhiteProp(params) {
    if (!params) return false;

    if (typeof params !== 'object') return false;

    return params.name && ['reduce', 'keys', 'prototype'].indexOf(params.name) > -1;
}

function checkWhitePropAndObject(node) {
    if (!node) return false;

    const leftNode = node.left;

    if (!leftNode) return false;

    const { object = {}, property = {} } = leftNode;

    if (inWhiteObject(object) && inWhiteProp(property)) return true;

    return false;
}
