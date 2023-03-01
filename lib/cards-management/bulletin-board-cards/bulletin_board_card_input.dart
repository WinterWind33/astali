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
