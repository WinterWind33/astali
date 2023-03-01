// Copyright (c) 2023 Andrea Ballestrazzi

import 'bulletin_board_card_id.dart';

// Core and engine
// Input managment
import 'package:flutter/gestures.dart';

typedef OnPointerUpOnBulletinBoardCard = void Function(
    BulletinBoardCardID, PointerUpEvent);

typedef OnPointerDownOnBulletinBoardCard = void Function(
    BulletinBoardCardID, PointerDownEvent);

typedef OnBulletinBoardCardFocusChanged = void Function(
    BulletinBoardCardID, bool);

/// Represents the basic interface of a card controller that can handle raw
/// inputs for a bulletin board card.
abstract class BulletinBoardCardRawInputController {
  void onPointerUpOnCard(
      BulletinBoardCardID cardID, PointerUpEvent pointerUpEvent);

  void onPointerDownOnCard(
      BulletinBoardCardID cardID, PointerDownEvent pointerDownEvent);

  void onCardFocusChanged(BulletinBoardCardID cardID, bool bHasFocus);
}

typedef OnPointerUpOnBBCardBroadcastSet = Set<OnPointerUpOnBulletinBoardCard>;
typedef OnPointerDownOnBBCardBroadcastSet
    = Set<OnPointerDownOnBulletinBoardCard>;
typedef OnBBCardFocusChangedBroadcastSet = Set<OnBulletinBoardCardFocusChanged>;

class BulletinBoardCardRawInputNotifier
    implements BulletinBoardCardRawInputController {
  BulletinBoardCardRawInputNotifier(
      OnPointerUpOnBBCardBroadcastSet pointerUpOnBBCardBroadcastSet,
      OnPointerDownOnBBCardBroadcastSet pointerDownOnBBCardBroadcastSet,
      OnBBCardFocusChangedBroadcastSet cardFocusChangedBroadcastSet,
      BulletinBoardCardRawInputController? forwardController)
      : _pointerUpBroadcastSet = pointerUpOnBBCardBroadcastSet,
        _pointerDownBroadcastSet = pointerDownOnBBCardBroadcastSet,
        _cardFocusChangedBroadcastSet = cardFocusChangedBroadcastSet,
        _forwardController = forwardController;

  @override
  void onCardFocusChanged(BulletinBoardCardID cardID, bool bHasFocus) {
    // If there is a forwarded controller we need to pass the event
    // to it so it can be processed accordingly.
    _forwardController?.onCardFocusChanged(cardID, bHasFocus);

    // If there are callbacks that are listening to this event we need
    // to broadcast it to them.
    for (var callbackEvent in _cardFocusChangedBroadcastSet) {
      callbackEvent(cardID, bHasFocus);
    }
  }

  @override
  void onPointerDownOnCard(
      BulletinBoardCardID cardID, PointerDownEvent pointerDownEvent) {
    // If there is a forwarded controller we need to pass the event
    // to it so it can be processed accordingly.
    _forwardController?.onPointerDownOnCard(cardID, pointerDownEvent);

    // If there are callbacks that are listening to this event we need
    // to broadcast it to them.
    for (var callbackEvent in _pointerDownBroadcastSet) {
      callbackEvent(cardID, pointerDownEvent);
    }
  }

  @override
  void onPointerUpOnCard(
      BulletinBoardCardID cardID, PointerUpEvent pointerUpEvent) {
    // If there is a forwarded controller we need to pass the event
    // to it so it can be processed accordingly.
    _forwardController?.onPointerUpOnCard(cardID, pointerUpEvent);

    // If there are callbacks that are listening to this event we need
    // to broadcast it to them.
    for (var callbackEvent in _pointerUpBroadcastSet) {
      callbackEvent(cardID, pointerUpEvent);
    }
  }

  final OnPointerUpOnBBCardBroadcastSet _pointerUpBroadcastSet;
  final OnPointerDownOnBBCardBroadcastSet _pointerDownBroadcastSet;
  final OnBBCardFocusChangedBroadcastSet _cardFocusChangedBroadcastSet;
  final BulletinBoardCardRawInputController? _forwardController;
}
