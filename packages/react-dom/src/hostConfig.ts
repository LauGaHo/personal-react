import { DOMElement } from './SyntheticEvent';
import { FiberNode } from 'react-reconciler/src/fiber';
import { HostComponent, HostText } from 'react-reconciler/src/workTags';
import { Props } from 'shared/ReactTypes';
import { updateFiberProps } from './SyntheticEvent';

export type Container = Element;
export type Instance = Element;
export type TextInstance = Text;

/**
 * 创建 DOM 节点
 * @param type {string} DOM 节点类型
 * @param props {Props} DOM 节点属性
 */
export const createInstance = (type: string, props: Props): Instance => {
	// TODO 处理 props
	const element = document.createElement(type) as unknown;
	updateFiberProps(element as DOMElement, props);
	return element as DOMElement;
};

/**
 * 将 child 节点插入到 parent 节点中
 * @param parent {Instance | Container} 父节点
 * @param child {Instance} 子节点
 */
export const appendInitialChild = (
	parent: Instance | Container,
	child: Instance
) => {
	parent.appendChild(child);
};

/**
 * 创建 Text 节点
 * @param content {string} Text 节点内容
 */
export const createTextInstance = (content: string) => {
	return document.createTextNode(content);
};

export const appendChildToContainer = appendInitialChild;

/**
 * 提交 Update 操作
 * @param fiber {FiberNode} Fiber 节点
 */
export function commitUpdate(fiber: FiberNode) {
	switch (fiber.tag) {
		case HostText:
			const text = fiber.memoizedProps?.content;
			return commitTextUpdate(fiber.stateNode, text);

		case HostComponent:
			return updateFiberProps(fiber.stateNode, fiber.memoizedProps);

		default:
			if (__DEV__) {
				console.warn('未实现的 Update 类型', fiber);
			}
			break;
	}
}

/**
 * 提交 Text 节点的 Update 操作
 * @param textInstance {TextInstance} Text 节点实例对象
 * @param content {string} Text 节点内容
 */
export function commitTextUpdate(textInstance: TextInstance, content: string) {
	textInstance.textContent = content;
}

/**
 * 移除某个 DOM 节点下的某个 child 节点
 * @param child {Instance | TextInstance} 子节点
 * @param container {Container} 父节点
 */
export function removeChild(
	child: Instance | TextInstance,
	container: Container
) {
	container.removeChild(child);
}

/**
 * 将 child 节点插入到 container 节点中，插入到 before 节点前面
 * @param child {Instance} 目标子节点
 * @param container {Container} 父节点
 * @param before {Instance} 目标子节点的前一个兄弟节点
 */
export function insertChildToContainer(
	child: Instance,
	container: Container,
	before: Instance
) {
	container.insertBefore(child, before);
}

/**
 * 根据宿主环境获取支持微任务的形式，用于使用微任务执行调度任务
 */
export const scheduleMicroTask =
	typeof queueMicrotask === 'function'
		? queueMicrotask
		: typeof Promise === 'function'
		? (callback: (...args: any) => void) => Promise.resolve(null).then(callback)
		: setTimeout;

/**
 * 隱藏 HostComponent 邏輯
 *
 * @param {Instance} instance - 被隱藏的對象
 */
export function hideInstance(instance: Instance) {
	const style = (instance as HTMLElement).style;
	style.setProperty('display', 'none', 'important');
}

/**
 * 顯示 HostComponent 邏輯
 *
 * @param {Instance} instance - 顯示對象
 */
export function unHideInstance(instance: Instance) {
	const style = (instance as HTMLElement).style;
	style.display = '';
}

/**
 * 隱藏 HostText 邏輯
 *
 * @param {Instance} textInstance - 隱藏對象
 */
export function hideTextInstance(textInstance: Instance) {
	textInstance.nodeValue = '';
}

/**
 * 顯示 HostText 邏輯
 *
 * @param {Instance} textInstance - 顯示對象
 * @param {string} text - 文本內容
 */
export function unHideTextInstance(textInstance: Instance, text: string) {
	textInstance.nodeValue = text;
}
