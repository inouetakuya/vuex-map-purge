import * as ts from 'typescript'
import { getVuexArguments } from './utils/vuex-extraction'
import * as defineFunction from './utils/defineFunction'

const CATCH_KEYWORD = 'methods'
const UTIL_KEYWORD = 'mapActions'

function isMethods(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node)) {
    return false
  }
  const propAssignment: ts.PropertyAssignment = node

  if (!ts.isIdentifier(propAssignment.name)) {
    return false
  }
  const propAssignmentName: ts.Identifier = propAssignment.name

  if (propAssignmentName.escapedText !== CATCH_KEYWORD) {
    return false
  }
  return true
}

export const purgeMapActions = <T extends ts.Node>(
  context: ts.TransformationContext
) => (rootNode: T) => {
  let isCheckedMode: boolean = false
  let isJavaScriptMode: boolean = false

  function visit(node: ts.Node): ts.Node {
    if (!isCheckedMode) {
      isCheckedMode = true
      isJavaScriptMode =
        node.getFullText().indexOf('// [vuex-map-purge]: js') === 0
    }

    node = ts.visitEachChild(node, visit, context)

    if (!ts.isPropertyAssignment(node)) {
      return node
    }
    if (!isMethods(node)) {
      return node
    }
    const propAssignment: ts.PropertyAssignment = node
    if (!ts.isObjectLiteralExpression(propAssignment.initializer)) {
      return node
    }
    const initializer: ts.ObjectLiteralExpression = propAssignment.initializer

    initializer.properties = ts.createNodeArray<ts.ObjectLiteralElementLike>(
      initializer.properties.reduce((before, current) => {
        const fallback = ts.createNodeArray<ts.ObjectLiteralElementLike>([
          ...before,
          current,
        ])
        // mapActions always used with spread operator
        if (!ts.isSpreadAssignment(current)) {
          return fallback
        }

        if (!ts.isCallExpression(current.expression)) {
          return fallback
        }

        const maybeMapActions: ts.CallExpression = current.expression
        if (!ts.isIdentifier(maybeMapActions.expression)) {
          return fallback
        }

        const maybeMapActionsCallName: ts.Identifier =
          maybeMapActions.expression
        if (maybeMapActionsCallName.escapedText !== UTIL_KEYWORD) {
          return fallback
        }

        const mapActions = maybeMapActions
        let list: ts.NodeArray<ts.Expression> = ts.createNodeArray()
        let prefix: string

        try {
          const r = getVuexArguments(mapActions.arguments)
          prefix = r[0] ? `${r[0]}/` : ''
          list = r[1]
        } catch (e) {
          return fallback
        }

        return ts.createNodeArray([
          ...before,
          ...list.map((arg) => {
            if (!ts.isStringLiteral(arg)) {
              throw new Error('Unexpected argument')
            }
            return ts.createMethod(
              undefined,
              undefined,
              undefined,
              ts.createIdentifier(arg.text),
              undefined,
              undefined,
              defineFunction.getPayloadParameter(!isJavaScriptMode),
              defineFunction.getReturnType(!isJavaScriptMode),
              ts.createBlock([
                ts.createReturn(
                  ts.createCall(
                    ts.createPropertyAccess(
                      ts.createPropertyAccess(ts.createThis(), '$store'),
                      'dispatch'
                    ),
                    undefined,
                    [
                      ts.createStringLiteral(`${prefix}${arg.text}`),
                      ts.createIdentifier('payload'),
                    ]
                  )
                ),
              ])
            )
          }),
        ])
      }, ts.createNodeArray<ts.ObjectLiteralElementLike>())
    )

    return node
  }
  return ts.visitNode(rootNode, visit)
}
