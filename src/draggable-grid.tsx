import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import {
  PanResponder,
  Animated,
  StyleSheet,
  StyleProp,
  GestureResponderEvent,
  PanResponderGestureState,
  ViewStyle,
  View,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  NativeScrollPoint
} from 'react-native'
import { Block } from './block'
import { findKey, findIndex, differenceBy, readNumber } from './utils'

const SCROLL_INTERVAL = 25

export interface IOnLayoutEvent {
  nativeEvent: { layout: { x: number; y: number; width: number; height: number } }
}

interface IBaseItemType {
  key: string
  disabledDrag?: boolean
  disabledReSorted?: boolean
}

export interface IScrollByOptions extends IPositionOffset {
  animated?: boolean
}

export interface IDraggableGridProps<DataType extends IBaseItemType> {
  numColumns: number
  data: DataType[]
  renderItem: (item: DataType, order: number) => React.ReactElement<any>
  style?: ViewStyle
  itemHeight?: number
  dragStartAnimation?: StyleProp<any>
  scrollAreaSize?: number
  scrollInterval?: number
  scrollStep?: number | ((iteration: number) => number)
  layoutOffset?: IPositionOffset
  onItemPress?: (item: DataType) => void
  onDragStart?: (item: DataType) => void
  onDragging?: (gestureState: PanResponderGestureState) => void
  onDragRelease?: (newSortedData: DataType[]) => void
  onResetSort?: (newSortedData: DataType[]) => void
}

interface IMap<T> {
  [key:string]: T
}
export interface IPositionOffset {
  x: number
  y: number
}
interface IOrderMapItem {
  order: number
}
interface IItem<DataType> {
  key: string
  itemData: DataType
  currentPosition: Animated.AnimatedValueXY
}

let activeBlockOffset = { x: 0, y: 0 }

export const DraggableGrid = function<DataType extends IBaseItemType>(
  props: IDraggableGridProps<DataType>,
) {
  const scrollAreaSize = readNumber(props.scrollAreaSize, 20)
  const scrollInterval = props.scrollInterval || SCROLL_INTERVAL

  const [blockPositions] = useState<IPositionOffset[]>([])
  const [orderMap] = useState<IMap<IOrderMapItem>>({})
  const [itemMap] = useState<IMap<DataType>>({})
  const [items] = useState<IItem<DataType>[]>([])
  const [blockHeight, setBlockHeight] = useState(0)
  const [blockWidth, setBlockWidth] = useState(0)
  const [gridHeight, setGridHeight] = useState(0)
  const [gridHeightValue] = useState<Animated.Value>(new Animated.Value(0))
  const [hadInitBlockSize, setHadInitBlockSize] = useState(false)
  const [dragStartAnimatedValue] = useState(new Animated.Value(1))
  const [gridLayout, setGridLayout] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })
  const [activeItemIndex, setActiveItemIndex] = useState<undefined | number>()
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const contentOffset = useRef<NativeScrollPoint>({ x: 0, y: 0 })
  const dragOffset = useRef({ x: 0, y: 0})
  const scrollTimer = useRef<number>(0)
  const scrollView = React.useRef<ScrollView>(null)
  const animatedView = React.useRef<View>(null)
  const layoutOffsetX = props.layoutOffset?.x || 0
  const layoutOffsetY = props.layoutOffset?.y || 0

  const assessGridSize = (event: IOnLayoutEvent) => {
    if (!hadInitBlockSize) {
      const { layout } = event.nativeEvent

      layout.x += layoutOffsetX
      layout.y += layoutOffsetY
      
      let blockWidth = layout.width / props.numColumns
      let blockHeight = props.itemHeight || blockWidth
      setBlockWidth(blockWidth)
      setBlockHeight(blockHeight)
      setGridLayout(layout)
      setHadInitBlockSize(true)

      animatedView.current?.measure((x, y, width, height, pageX, pageY) => {
        layout.x = pageX + layoutOffsetX
        layout.y = pageY + layoutOffsetY

        setGridLayout(layout)

        //layout.width = width
        //layout.height = height
      })
    }
  }
  const [panResponderCapture, setPanResponderCapture] = useState(false)

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: () => panResponderCapture,
    onMoveShouldSetPanResponderCapture: () => panResponderCapture,
    onShouldBlockNativeResponder: () => false,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: onStartDrag,
    onPanResponderMove: onHandMove,
    onPanResponderRelease: onHandRelease,
  })

  function initBlockPositions() {
    items.forEach((_, index) => {
      blockPositions[index] = getBlockPositionByOrder(index)
    })
  }
  function getBlockPositionByOrder(order: number) {
    if (blockPositions[order]) {
      return blockPositions[order]
    }
    const columnOnRow = order % props.numColumns
    const y = blockHeight * Math.floor(order / props.numColumns)
    const x = columnOnRow * blockWidth
    return {
      x,
      y,
    }
  }
  function getScrollStep(index: number): number {
    if (typeof props.scrollStep === 'function') {
      return props.scrollStep(index)
    } else if (props.scrollStep || props.scrollStep === 0) {
      return props.scrollStep
    }

    return index > 120 ? 18 : 9 // double speed after 3s
  }
  function resetGridHeight() {
    const rowCount = Math.ceil(props.data.length / props.numColumns)
    const height = rowCount * blockHeight

    setGridHeight(height)
    gridHeightValue.setValue(height)
  }
  function startAutoScroll({ shouldScroll, getScrollStep }: {
    shouldScroll: () => boolean
    getScrollStep: (scrollStepIteration: number) => number
  }) {
    const activeItem = getActiveItem()

    if (!activeItem) return

    let i = 0

    const handleAutoScroll = () => {
      if (shouldScroll()) {
        const scrollStep = getScrollStep(i++)
        
        scrollBy({ x: 0, y: scrollStep })
        dragOffset.current.y += scrollStep

        moveBlockBy({
          x: 0,
          y: scrollStep,
        })
      } else {
        stopAutoScroll()
      }
    }

    if (shouldScroll()) {
      //handleAutoScroll()
      scrollTimer.current = setInterval(handleAutoScroll, scrollInterval)
    }
  }
  function stopAutoScroll() {
    clearInterval(scrollTimer.current)
    scrollTimer.current = 0
  }
  function scrollBy({ x, y, animated = false }: IScrollByOptions) {
    if (!scrollView.current) return false
    
    scrollView.current.scrollTo({
      x: contentOffset.current.x + x,
      y: contentOffset.current.y + y,
      animated,
    })
    
    contentOffset.current.x += x
    contentOffset.current.y += y

    return true
  }
  function moveBlockTo(newPosition: IPositionOffset) {
    const activeItem = getActiveItem()
    if (!activeItem) return false

    const originPosition = blockPositions[orderMap[activeItem.key].order]
    const dragPositionToActivePositionDistance = getDistance(newPosition, originPosition)
    activeItem.currentPosition.setValue(newPosition)

    let closetItemIndex = activeItemIndex as number
    let closetDistance = dragPositionToActivePositionDistance

    items.forEach((item, index) => {
      if (item.itemData.disabledReSorted) return
      if (index != activeItemIndex) {
        const dragPositionToItemPositionDistance = getDistance(
          newPosition,
          blockPositions[orderMap[item.key].order],
        )
        if (
          dragPositionToItemPositionDistance < closetDistance &&
          dragPositionToItemPositionDistance < blockWidth
        ) {
          closetItemIndex = index
          closetDistance = dragPositionToItemPositionDistance
        }
      }
    })
    if (activeItemIndex != closetItemIndex) {
      const closetOrder = orderMap[items[closetItemIndex].key].order
      resetBlockPositionByOrder(orderMap[activeItem.key].order, closetOrder)
      orderMap[activeItem.key].order = closetOrder
      props.onResetSort && props.onResetSort(getSortData())
    }
  }
  function moveBlockBy(offset: IPositionOffset) {
    const activeItem = getActiveItem()

    if (!activeItem) return false

    moveBlockTo({
      x: (activeItem.currentPosition.x as any)._value + offset.x,
      y: (activeItem.currentPosition.y as any)._value + offset.y,
    })

    return true
  }
  function onBlockPress(itemIndex: number) {
    props.onItemPress && props.onItemPress(items[itemIndex].itemData)
  }
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    contentOffset.current = e.nativeEvent.contentOffset
  }
  function onStartDrag(_: GestureResponderEvent, gestureState: PanResponderGestureState) {
    const activeItem = getActiveItem()
    if (!activeItem) return false
    props.onDragStart && props.onDragStart(activeItem.itemData)
    setIsDragging(true)
    dragOffset.current = { x: 0, y: 0 }
    const { x0, y0, moveX, moveY } = gestureState
    const activeOrigin = blockPositions[orderMap[activeItem.key].order]
    const x = activeOrigin.x - x0
    //const y = y0 - activeOrigin.y - layoutOffsetY
    const y = activeOrigin.y - y0
    activeItem.currentPosition.setOffset({
      x,
      y,
    })
    activeBlockOffset = {
      x,
      y,
    }
    activeItem.currentPosition.setValue({
      x: moveX,
      y: moveY,
    })
  }
  function onHandMove(_: GestureResponderEvent, gestureState: PanResponderGestureState) {
    const activeItem = getActiveItem()
    if (!activeItem) return false
    const { moveX, moveY } = gestureState
    props.onDragging && props.onDragging(gestureState)
    setIsDragging(false)

    const xChokeAmount = Math.max(0, activeBlockOffset.x + moveX - (gridLayout.width - blockWidth))
    const xMinChokeAmount = Math.min(0, activeBlockOffset.x + moveX)

    const dragPosition = {
      x: moveX - xChokeAmount - xMinChokeAmount + dragOffset.current.x,
      y: moveY + dragOffset.current.y,
    }

    const startOffset = gridLayout.y + contentOffset.current.y
    const startY = startOffset + scrollAreaSize
    const endY = startOffset + gridLayout.height - scrollAreaSize

    const blockY = dragPosition.y

    if (!scrollTimer.current) {
      if (blockY + blockHeight > endY) {
        startAutoScroll({
          shouldScroll: () => {
            const endReached = (gridHeight - (contentOffset.current.y + gridLayout.height)) <= 1.5
            const currentY: number = (activeItem.currentPosition.y as any)._value + blockHeight
            
            return !endReached && currentY > endY
          },
          getScrollStep: (i) => {
            const contentOffsetY = contentOffset.current.y
            let scrollStep = getScrollStep(i)

            if (contentOffsetY + scrollStep > gridHeight) {
              scrollStep = gridHeight - contentOffsetY
            }

            return scrollStep
          }
        })
      } else if (blockY < startY) {
        startAutoScroll({
          shouldScroll: () => {
            const topReached = contentOffset.current.y <= 0
            const currentY: number = (activeItem.currentPosition.y as any)._value
            
            return !topReached && currentY < startY
          },
          getScrollStep: (i) => {
            const contentOffsetY = contentOffset.current.y
            let scrollStep = getScrollStep(i)

            if (contentOffsetY - scrollStep < 0) {
              scrollStep = contentOffsetY
            }

            return -scrollStep
          }
        })
      }
    }

    moveBlockTo(dragPosition)
  }
  function onHandRelease() {
    const activeItem = getActiveItem()
    if (!activeItem) return false
    if (scrollTimer.current) stopAutoScroll()
    props.onDragRelease && props.onDragRelease(getSortData())
    setPanResponderCapture(false)
    activeItem.currentPosition.flattenOffset()
    moveBlockToBlockOrderPosition(activeItem.key)
    setActiveItemIndex(undefined)
  }
  function resetBlockPositionByOrder(activeItemOrder: number, insertedPositionOrder: number) {
    let disabledReSortedItemCount = 0
    if (activeItemOrder > insertedPositionOrder) {
      for (let i = activeItemOrder - 1; i >= insertedPositionOrder; i--) {
        const key = getKeyByOrder(i)
        const item = itemMap[key]
        if (item && item.disabledReSorted) {
          disabledReSortedItemCount++
        } else {
          orderMap[key].order += disabledReSortedItemCount + 1
          disabledReSortedItemCount = 0
          moveBlockToBlockOrderPosition(key)
        }
      }
    } else {
      for (let i = activeItemOrder + 1; i <= insertedPositionOrder; i++) {
        const key = getKeyByOrder(i)
        const item = itemMap[key]
        if (item && item.disabledReSorted) {
          disabledReSortedItemCount++
        } else {
          orderMap[key].order -= disabledReSortedItemCount + 1
          disabledReSortedItemCount = 0
          moveBlockToBlockOrderPosition(key)
        }
      }
    }
  }
  function moveBlockToBlockOrderPosition(itemKey: string) {
    const itemIndex = findIndex(items, item => item.key === itemKey)
    items[itemIndex].currentPosition.flattenOffset()
    Animated.timing(items[itemIndex].currentPosition, {
      toValue: blockPositions[orderMap[itemKey].order],
      duration: 200,
      useNativeDriver: false
    }).start()
  }
  function getKeyByOrder(order: number) {
    return findKey(orderMap, (item: IOrderMapItem) => item.order === order) as string
  }

  function getSortData() {
    const sortData: DataType[] = []
    items.forEach(item => {
      sortData[orderMap[item.key].order] = item.itemData
    })
    return sortData
  }
  function getDistance(startOffset: IPositionOffset, endOffset: IPositionOffset) {
    const xDistance = startOffset.x + activeBlockOffset.x - endOffset.x
    const yDistance = startOffset.y + activeBlockOffset.y - endOffset.y
    return Math.sqrt(Math.pow(xDistance, 2) + Math.pow(yDistance, 2))
  }
  function setActiveBlock(itemIndex: number, item: DataType) {
    if (item.disabledDrag) return

    setPanResponderCapture(true)
    setActiveItemIndex(itemIndex)
  }
  function startDragStartAnimation() {
    if (!props.dragStartAnimation) {
      dragStartAnimatedValue.setValue(1)
      Animated.timing(dragStartAnimatedValue, {
        toValue: 1.1,
        duration: 100,
        useNativeDriver: false
      }).start()
    }
  }
  function getBlockStyle(itemIndex: number) {
    return [
      {
        justifyContent: 'center',
        alignItems: 'center',
      },
      hadInitBlockSize && {
        width: blockWidth,
        height: blockHeight,
        position: 'absolute',
        top: items[itemIndex].currentPosition.getLayout().top,
        left: items[itemIndex].currentPosition.getLayout().left,
      },
    ]
  }
  function getDragStartAnimation(itemIndex: number) {
    if (activeItemIndex != itemIndex) {
      return
    }

    const dragStartAnimation = props.dragStartAnimation || getDefaultDragStartAnimation()
    return {
      zIndex: 3,
      ...dragStartAnimation,
    }
  }
  function getActiveItem() {
    if (activeItemIndex === undefined) return false
    return items[activeItemIndex]
  }
  function getDefaultDragStartAnimation() {
    return {
      transform: [
        {
          scale: dragStartAnimatedValue,
        },
      ],
      shadowColor: '#000000',
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: {
        width: 1,
        height: 1,
      },
    }
  }
  function addItem(item: DataType, index: number) {
    blockPositions.push(getBlockPositionByOrder(items.length))
    orderMap[item.key] = {
      order: index,
    }
    itemMap[item.key] = item
    items.push({
      key: item.key,
      itemData: item,
      currentPosition: new Animated.ValueXY(getBlockPositionByOrder(index)),
    })
  }

  function removeItem(item: IItem<DataType>) {
    const itemIndex = findIndex(items, curItem => curItem.key === item.key)
    items.splice(itemIndex, 1)
    blockPositions.pop()
    delete orderMap[item.key]
  }
  function diffData() {
    props.data.forEach((item, index) => {
      if (orderMap[item.key]) {
        if (orderMap[item.key].order != index) {
          orderMap[item.key].order = index
          moveBlockToBlockOrderPosition(item.key)
        }
        const currentItem = items.find(i => i.key === item.key)
        if (currentItem) {
          currentItem.itemData = item
        }
        itemMap[item.key] = item
      } else {
        addItem(item, index)
      }
    })
    const deleteItems = differenceBy(items, props.data, 'key')
    deleteItems.forEach(item => {
      removeItem(item)
    })
  }
  useEffect(() => {
    startDragStartAnimation()
  }, [activeItemIndex])
  useEffect(() => {
    if (hadInitBlockSize) {
      initBlockPositions()
    }
  }, [gridLayout])
  useEffect(() => {
    resetGridHeight()
  })
  if (hadInitBlockSize) {
    diffData()
  }
  const itemList = items.map((item, itemIndex) => {
    return (
      <Block
        onPress={onBlockPress.bind(null, itemIndex)}
        onLongPress={setActiveBlock.bind(null, itemIndex, item.itemData)}
        panHandlers={panResponder.panHandlers}
        style={getBlockStyle(itemIndex)}
        dragStartAnimationStyle={getDragStartAnimation(itemIndex)}
        key={item.key}>
        {props.renderItem(item.itemData, orderMap[item.key].order)}
      </Block>
    )
  })

  return (
    <ScrollView
      scrollEnabled={!isDragging}
      onLayout={assessGridSize}
      onScroll={onScroll}
      scrollEventThrottle={0.9 * scrollInterval}
      ref={scrollView}
    >
      <Animated.View
        ref={animatedView}
        style={[
          styles.draggableGrid,
          props.style,
          {
            height: gridHeightValue,
          },
        ]}
      >
        {hadInitBlockSize && itemList}
      </Animated.View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  draggableGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
