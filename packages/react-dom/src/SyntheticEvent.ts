import { Container } from 'hostConfig';
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

// 将用户绑定的自定义事件回调存放在 DOM[elementPropsKey] 中
export function updateFiberProps(node: DOMElement, props: Props) {
	node[elementPropsKey] = props;
}

// 初始化事件
export function initEvent(container: Container, eventType: string) {
	if (!validEventTypeList.includes(eventType)) {
		console.warn('当前不支持', eventType, '事件');
		return;
	}
	if (__DEV__) {
		console.log('初始化事件: ', eventType);
	}
	container.addEventListener(eventType, (e) => {
		dispatchEvent(container, eventType, e);
	});
}

// 根据已有的 Event 事件对象，创建 SyntheticEvent 合成事件对象
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

// 遍历 capture 或 bubble 数组，取决于传进来的是 capture 还是 bubble
function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
	for (let i = 0; i < paths.length; i++) {
		const callback = paths[i];
		callback.call(null, se);

		if (se.__stopPropagation) {
			break;
		}
	}
}

// 根据事件的名称获取事件的 callback 名字
// 如：根据 click 获取 onClick 和 onClickCapture 这两个名字
function getEventCallbackNameFromEventType(
	eventType: string
): string[] | undefined {
	return {
		// 注意这里顺序的问题，第 0 项为捕获阶段，第 1 项为冒泡阶段
		click: ['onClickCapture', 'onClick']
	}[eventType];
}

// 收集 targetElement 到 container 沿途的 capture 和 bubble 事件
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
					const eventCallback = elementProps[callbackName];
					if (eventCallback) {
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
		targetElement = targetElement.parentNode as DOMElement;
	}
	return paths;
}
