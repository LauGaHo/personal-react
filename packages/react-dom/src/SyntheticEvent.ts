import { Container } from 'hostConfig';
import {
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_runWithPriority,
	unstable_UserBlockingPriority
} from 'scheduler';
import { Props } from 'shared/ReactTypes';

// 定义 DOM 中的承载合成事件的属性名
export const elementPropsKey = '__props';
// 定义暂时可用的事件名
const validEventTypeList = ['click'];

// 声明事件回调类型
type EventCallback = (e: Event) => void;

// 声明合成事件 SyntheticEvent 继承 Event
interface SyntheticEvent extends Event {
	__stopPropagation: boolean;
}

// 声明了从事件触发的节点到根节点之间的 capture 事件回调和 bubble 事件回调
interface Paths {
	capture: EventCallback[];
	bubble: EventCallback[];
}

// 声明了 DOMElement 继承了 Element
export interface DOMElement extends Element {
	[elementPropsKey]: Props;
}

/**
 * 将用户绑定的自定义事件回调存放在 DOM[elementPropsKey] 中
 * @param node {DOMElement} DOM 节点实例对象
 * @param props {Props} 用户绑定的自定义事件回调
 */
export function updateFiberProps(node: DOMElement, props: Props) {
	node[elementPropsKey] = props;
}

/**
 * 初始化事件
 * @param container {Container} 事件绑定的根节点
 * @param eventType {string} 事件类型
 */
export function initEvent(container: Container, eventType: string) {
	if (!validEventTypeList.includes(eventType)) {
		console.warn('当前不支持', eventType, '事件');
		return;
	}
	if (__DEV__) {
		console.log('初始化事件: ', eventType);
	}
	container.addEventListener(eventType, (e) => {
		// 代理分发事件
		dispatchEvent(container, eventType, e);
	});
}

/**
 * 根据已有的 Event 事件对象，创建 SyntheticEvent 合成事件对象
 * @param e {Event} 事件对象
 */
function createSyntheticEvent(e: Event) {
	const syntheticEvent = e as SyntheticEvent;
	syntheticEvent.__stopPropagation = false;
	const originStopPropagation = e.stopPropagation;

	syntheticEvent.stopPropagation = () => {
		syntheticEvent.__stopPropagation = true;
		if (originStopPropagation) {
			originStopPropagation();
		}
	};
	return syntheticEvent;
}

/**
 * React 代理分发事件
 * @param container {Container} 事件绑定的根节点
 * @param eventType {string} 事件类型
 * @param e {Event} 事件对象
 */
function dispatchEvent(container: Container, eventType: string, e: Event) {
	const targetElement = e.target;

	if (targetElement === null) {
		console.warn('事件不存在 target', e);
		return;
	}
	// 1. 收集沿途的事件
	const { bubble, capture } = collectPaths(
		targetElement as DOMElement,
		container,
		eventType
	);
	// 2. 构造合成事件
	const se = createSyntheticEvent(e);
	// 3. 遍历 capture
	triggerEventFlow(capture, se);

	if (!se.__stopPropagation) {
		// 4. 遍历 bubble
		triggerEventFlow(bubble, se);
	}
}

/**
 * 遍历 capture 或 bubble 数组，取决于传进来的是 capture 还是 bubble
 * @param paths {EventCallback[]} capture 数组或者 bubble 数组
 * @param se {SyntheticEvent} React 合成事件实例对象
 */
function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
	// 按照顺序依次执行事件回调
	for (let i = 0; i < paths.length; i++) {
		const callback = paths[i];
		// 交给调度器执行对应的事件回调
		unstable_runWithPriority(eventTypeToSchedulerPriority(se.type), () => {
			callback.call(null, se);
		});

		if (se.__stopPropagation) {
			break;
		}
	}
}

/**
 * 根据事件名称获取事件的 callback 名字
 * 如：根据 click 获取 onClick 和 onClickCapture 这两个名字
 * @param eventType {string} 事件名称
 */
function getEventCallbackNameFromEventType(
	eventType: string
): string[] | undefined {
	return {
		// 注意这里顺序的问题，第 0 项为捕获阶段，第 1 项为冒泡阶段
		click: ['onClickCapture', 'onClick']
	}[eventType];
}

/**
 * 收集 targetElement 到 container 沿途的 capture 和 bubble 事件
 * @param targetElement {DOMElement} 事件触发的节点
 * @param container {Container} 事件绑定的根节点
 * @param eventType {string} 事件类型
 */
function collectPaths(
	targetElement: DOMElement,
	container: Container,
	eventType: string
) {
	const paths: Paths = {
		capture: [],
		bubble: []
	};

	// 收集沿途相关的 capture 和 bubble 事件
	// 如 click，就收集 onClick 和 onClickCapture
	while (targetElement && targetElement !== container) {
		const elementProps = targetElement[elementPropsKey];
		if (elementProps) {
			// click -> onClick, onClickCapture
			const callbackNameList = getEventCallbackNameFromEventType(eventType);
			if (callbackNameList) {
				callbackNameList.forEach((callbackName, i) => {
					// 获取开发者绑定的事件回调
					const eventCallback = elementProps[callbackName];
					if (eventCallback) {
						// 这里对应 getEventCallbackNameFromEventType 中的顺序，0 为捕获阶段，1 为冒泡阶段
						if (i === 0) {
							// capture
							paths.capture.unshift(eventCallback);
						} else {
							// bubble
							paths.bubble.push(eventCallback);
						}
					}
				});
			}
		}
		// 向上查找对应的父节点
		targetElement = targetElement.parentNode as DOMElement;
	}
	// 返回收集到的事件
	return paths;
}

/**
 * 根据不同的事件，转换成调度器 Scheduler 中的优先级
 * @param eventType {string} 事件类型
 */
function eventTypeToSchedulerPriority(eventType: string) {
	switch (eventType) {
		case 'click':
		case 'keydown':
		case 'keyup':
			return unstable_ImmediatePriority;
		case 'scroll':
			return unstable_UserBlockingPriority;
		default:
			return unstable_NormalPriority;
	}
}
