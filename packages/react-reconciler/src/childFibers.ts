import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { Key, Props, ReactElementType } from 'shared/ReactTypes';
import {
	createFiberFromElement,
	createFiberFromFragment,
	createWorkInProgress,
	FiberNode
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { Fragment, HostText } from './workTags';

type ExistingChildren = Map<string | number, FiberNode>;

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

	// 删除某节点并删除该节点右边的所有兄弟节点
	function deleteRemainingChildren(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null
	) {
		if (!shouldTrackEffects) {
			return;
		}
		// 将某节点赋值为 childToDelete
		let childToDelete = currentFirstChild;
		// 循环删除该节点和该节点右边的所有兄弟节点
		while (childToDelete !== null) {
			deleteChild(returnFiber, childToDelete);
			childToDelete = childToDelete.sidling;
		}
	}

	// 根据 ReactElementType 生成对应的 fiberNode 节点
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		const key = element.key;
		while (currentFiber !== null) {
			// update 流程
			if (currentFiber.key === key) {
				// key 相同
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					if (currentFiber.type === element.type) {
						// 这里判断 ReactElement.type 是否等于 REACT_FRAGMENT_TYPE
						// 如果等于 REACT_FRAGMENT_TYPE，则将 ReactElement.props.children 赋值给 props，然后传值给 useFiber
						let props = element.props;
						if (element.type === REACT_FRAGMENT_TYPE) {
							props = element.props.children;
						}
						// type 相同
						const existing = useFiber(currentFiber, props);
						existing.return = returnFiber;
						// 当前节点可复用，标记剩下的节点删除
						deleteRemainingChildren(returnFiber, currentFiber.sidling);
						return existing;
					}
					// key 相同，type 不同，删掉所有旧的
					deleteRemainingChildren(returnFiber, currentFiber);
					break;
				} else {
					if (__DEV__) {
						console.warn('还未实现的 React 类型: ', element);
						break;
					}
				}
			} else {
				// key 不相同
				// 删掉旧的
				deleteChild(returnFiber, currentFiber);
				// 将该节点的 sidling 赋值为 currentFiber 变量，继续循环
				currentFiber = currentFiber.sidling;
			}
		}

		// 根据 element 创建 fiber
		let fiber;
		if (element.type === REACT_FRAGMENT_TYPE) {
			// 根据 Fragment 类型的 ReactElement 创建 FiberNode
			fiber = createFiberFromFragment(element.props.children, key);
		} else {
			// 根据 ReactElement 创建 FiberNode
			fiber = createFiberFromElement(element);
		}
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
		while (currentFiber !== null) {
			// update
			if (currentFiber.tag === HostText) {
				// 类型没变，可以复用
				const existing = useFiber(currentFiber, { content });
				// 为 fiber 节点的 return 属性赋值为 returnFiber
				existing.return = returnFiber;
				// 当前节点可复用，标记剩下的节点删除
				deleteRemainingChildren(returnFiber, currentFiber.sidling);
				return existing;
			}
			// 删掉旧的
			deleteChild(returnFiber, currentFiber);
			// 将该节点的 sidling 赋值为 currentFiber 变量，继续循环
			currentFiber = currentFiber.sidling;
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

	// 根据对应的 Array 对象生成对应的 FiberNode 类型数组
	function reconcileChildrenArray(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null,
		newChild: any[]
	) {
		// 记录在已经遍历过的 children 对应在 current 树中的 fiberNode 链表中最右位置对应的 index，也就是最大的 index
		let lastPlacedIndex: number = 0;
		// 记录当前正在处理的 fiberNode 的变量
		let lastNewFiber: FiberNode | null = null;
		// 记录最新的 fiberNode 链表中的第一个 fiberNode 对象
		let firstNewFiber: FiberNode | null = null;

		// 1. 将 current 保存在 map 中
		const existingChildren: ExistingChildren = new Map();
		// current 链表中的第一个 FiberNode 节点
		let current = currentFirstChild;
		// 遍历 current 链表，并将其存放在 Map 当中
		while (current !== null) {
			// 如果有 key，则使用 key 作为 map 的 key，如果没有，则使用 index 作为 map 的 key
			const keyToUse = current.key !== null ? current.key : current.index;
			// 从 existingChildren 中移除已经被复用的 fiberNode 对应的 key 和 value
			existingChildren.set(keyToUse, current);
			// 循环赋值 current 变量
			current = current.sidling;
		}

		// 遍历 newChild 数组，确认 fiberNode 是否可复用，并且标记移动还是插入
		for (let i = 0; i < newChild.length; i++) {
			// 2. 遍历 newChild，寻找是否可复用
			const after = newChild[i];
			// 通过 updateFromMap 获取复用或者是新创建的 fiberNode
			const newFiber = updateFromMap(returnFiber, existingChildren, i, after);

			if (newFiber === null) {
				continue;
			}

			// 3. 标记移动还是插入
			newFiber.index = i;
			newFiber.return = returnFiber;

			if (lastNewFiber === null) {
				// 第一次循环，同时为 lastNewFiber 和 firstNewFiber 变量赋值
				lastNewFiber = newFiber;
				firstNewFiber = newFiber;
			} else {
				// 非第一次循环，为 fiberNode 之间建立连接，并循环复制 lastNewFiber
				lastNewFiber.sidling = newFiber;
				lastNewFiber = lastNewFiber.sidling;
			}

			if (!shouldTrackEffects) {
				continue;
			}

			// 获取当前 fiber 对应的 current 树的 fiberNode 对象
			const current = newFiber.alternate;
			if (current !== null) {
				// 将 current 树的 fiberNode 中的 index 属性赋值到 oldIndex 中
				const oldIndex = current.index;
				// 此处通过判断 oldIndex 和 lastPlacedIndex 的大小可知到在 current 树中的相对位置
				// 本质上是一个排序的算法，不断判断两个元素之间的相对位置，从而得知是否需要移动
				if (oldIndex < lastPlacedIndex) {
					// 移动
					newFiber.flags |= Placement;
					continue;
				} else {
					// 不移动则直接更新 lastPlacedIndex
					lastPlacedIndex = oldIndex;
				}
			} else {
				// mount 相当于插入
				newFiber.flags |= Placement;
			}
		}
		// 4. 将 Map 中剩下的标记为删除
		existingChildren.forEach((fiber) => {
			deleteChild(returnFiber, fiber);
		});
		// 直接返回 firstNewFiber
		return firstNewFiber;
	}

	function updateFromMap(
		returnFiber: FiberNode,
		existingChildren: ExistingChildren,
		index: number,
		element: any
	): FiberNode | null {
		// 获取 element 的 key
		const keyToUse = element.key !== null ? element.key : index;
		const before = existingChildren.get(keyToUse);

		// HostText
		if (typeof element === 'string' || typeof element === 'number') {
			if (before) {
				// 可以复用
				if (before.tag === HostText) {
					// 因为可以复用，所以直接在 existingChildren 中删除对应的 key 和 value
					existingChildren.delete(keyToUse);
					// 并返回可直接复用的 FiberNode
					return useFiber(before, { content: element + '' });
				}
			}
			return new FiberNode(HostText, { content: element + '' }, null);
		}

		// ReactElement
		if (typeof element === 'object' && element !== null) {
			switch (element.$$typeof) {
				case REACT_ELEMENT_TYPE: {
					if (element.type === REACT_FRAGMENT_TYPE) {
						return updateFragment(
							returnFiber,
							before,
							element,
							keyToUse,
							existingChildren
						);
					}
					if (before) {
						if (before.type === element.type) {
							existingChildren.delete(keyToUse);
							return useFiber(before, element.props);
						}
					}
					return createFiberFromElement(element);
				}
			}

			// TODO 数组类型
			if (Array.isArray(element) && __DEV__) {
				console.warn('未实现数组类型的 child');
			}
		}

		// 数组里面又是数组的情况
		if (Array.isArray(element)) {
			return updateFragment(
				returnFiber,
				before,
				element,
				keyToUse,
				existingChildren
			);
		}

		return null;
	}

	// 返回给外界用于根据 element 不同类型生成不同的 fiberNode 的方法
	return function reconcileChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: any
	) {
		// 判断 Fragment
		// 这里的重点是 newChild.key 为空，则直接将 newChild.props.children 赋值给 newChild
		const isUnkeyedTopLevelFragment =
			typeof newChild === 'object' &&
			newChild !== null &&
			newChild.type === REACT_FRAGMENT_TYPE &&
			newChild.key === null;

		// 如果根节点是 Fragment，那么直接将根节点中的 props.children 赋值给 newChild 变量，这样就可以直接走 reconcileChildrenArray
		if (isUnkeyedTopLevelFragment) {
			newChild = newChild.props.children;
		}
		// 判断当前 fiber 的类型
		if (typeof newChild === 'object' && newChild !== null) {
			// 多节点的情况 ul>li*3
			if (Array.isArray(newChild)) {
				return reconcileChildrenArray(returnFiber, currentFiber, newChild);
			}

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

		// HostText
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleChild(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}

		if (currentFiber !== null) {
			// 兜底删除
			deleteRemainingChildren(returnFiber, currentFiber);
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

// 使用 Fragment 类型的 ReactElement 和 fiberNode 比对，判断是否能复用
function updateFragment(
	returnFiber: FiberNode,
	current: FiberNode | undefined,
	elements: any[],
	key: Key,
	existingChildren: ExistingChildren
) {
	let fiber;
	if (!current || current.tag !== Fragment) {
		// 如果 current 节点不存在，或者 current 节点的类型并非 Fragment，则直接根据 Fragment 类型的 ReactElement 创建一个 fiberNode
		fiber = createFiberFromFragment(elements, key);
	} else {
		// 可以复用的情况
		existingChildren.delete(key);
		fiber = useFiber(current, elements);
	}
	fiber.return = returnFiber;
	return fiber;
}

export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);
