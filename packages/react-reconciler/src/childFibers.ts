import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import { Props, ReactElementType } from 'shared/ReactTypes';
import {
	createFiberFromElement,
	createWorkInProgress,
	FiberNode
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { HostText } from './workTags';

function ChildReconciler(shouldTrackEffects: boolean) {
	// 为 FiberNode 的 flags 属性标记对应的 ChildDeletion 的 flags
	function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
		if (!shouldTrackEffects) {
			return;
		}

		// 获取父节点的 deletions 属性
		const deletions = returnFiber.deletions;
		// 若无则创建，若有则直接将 childToDelete 添加到 deletions
		if (deletions === null) {
			returnFiber.deletions = [childToDelete];
			returnFiber.flags |= ChildDeletion;
		} else {
			deletions.push(childToDelete);
		}
	}

	// 根据 ReactElementType 生成对应的 fiberNode 节点
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		const key = element.key;
		work: if (currentFiber !== null) {
			// update 流程
			if (currentFiber.key === key) {
				// key 相同
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					if (currentFiber.type === element.type) {
						// type 相同
						const existing = useFiber(currentFiber, element.props);
						existing.return = returnFiber;
						return existing;
					}
					// type 不相同，删除旧的
					deleteChild(returnFiber, currentFiber);
					break work;
				} else {
					if (__DEV__) {
						console.warn('还未实现的 React 类型: ', element);
						break work;
					}
				}
			} else {
				// key 不相同
				// 删掉旧的
				deleteChild(returnFiber, currentFiber);
			}
		}

		// 根据 element 创建 fiber
		const fiber = createFiberFromElement(element);
		// 为 fiber 节点的 return 属性赋值为 returnFiber
		fiber.return = returnFiber;
		return fiber;
	}

	// 根据对应的 textContent 生成文本节点对应的 fiberNode 节点
	function reconcileSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
		if (currentFiber !== null) {
			// update
			if (currentFiber.tag === HostText) {
				// 类型没变，可以复用
				const existing = useFiber(currentFiber, { content });
				// 为 fiber 节点的 return 属性赋值为 returnFiber
				existing.return = returnFiber;
				return existing;
			}
			deleteChild(returnFiber, currentFiber);
		}

		const fiber = new FiberNode(HostText, { content }, null);
		fiber.return = returnFiber;
		return fiber;
	}

	// 判断是否需要打 flag
	function placeSingleChild(fiber: FiberNode) {
		if (shouldTrackEffects && fiber.alternate === null) {
			fiber.flags |= Placement;
		}
		return fiber;
	}

	// 返回给外界用于根据 element 不同类型生成不同的 fiberNode 的方法
	return function reconcileChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: ReactElementType
	) {
		// 判断当前 fiber 的类型
		if (typeof newChild === 'object' && newChild !== null) {
			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					return placeSingleChild(
						reconcileSingleElement(returnFiber, currentFiber, newChild)
					);

				default:
					if (__DEV__) {
						console.warn('未实现的reconcile类型: ', newChild);
					}
					break;
			}
		}

		// TODO 多节点的情况 ul>li*3

		// HostText
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleChild(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}

		if (currentFiber !== null) {
			// 兜底删除
			deleteChild(returnFiber, currentFiber);
		}

		if (__DEV__) {
			console.warn('未实现的reconcile类型: ', newChild);
		}

		return null;
	};
}

// 复用 fiberNode 逻辑
function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
	// 根据 current 的 fiberNode 传入到 createWorkInProgress 函数得到复用的 fiberNode，也就是current 的 alternate
	const clone = createWorkInProgress(fiber, pendingProps);
	clone.index = 0;
	clone.sidling = null;
	// 返回对应的 clone 节点
	return clone;
}

export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);
