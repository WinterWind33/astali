// Copyright (C) 2023 Andrea Ballestrazzi

// Scenes
import 'scenes/bulletin_board_scene.dart';

// Settings
import 'settings/astali_about_dialog.dart';

// Core and engine
import 'package:flutter/material.dart';

typedef OnAboutItemClicked = VoidCallback;
typedef OnSaveBoardClicked = VoidCallback;

/// Represents a set of callbacks used inside the presentation
/// of the astali app home.
class ScenesCommonCallbacks {
  const ScenesCommonCallbacks(
      {required this.onAboutButtonClicked, required this.onSaveBoardClicked});

  // When the 'About' button is clicked inside the settings menu.
  final OnAboutItemClicked onAboutButtonClicked;
  final OnSaveBoardClicked onSaveBoardClicked;
}

class AstaliAppHomePresentation extends StatelessWidget {
  const AstaliAppHomePresentation({required this.commonCallbacks, super.key});

  final ScenesCommonCallbacks commonCallbacks;

  /// Creates the body of the main user interface.
  AppBar _createSceneTopBar() {
    return AppBar(
      title: const Text("Bulletin Board"),
      backgroundColor: Colors.blue,
      actions: <Widget>[
        PopupMenuButton<String>(
          icon: const Icon(Icons.settings),
          tooltip: "Settings",
          onSelected: (value) {
            switch (value) {
              case "About":
                commonCallbacks.onAboutButtonClicked();
                break;
              case "SaveBoard":
                commonCallbacks.onSaveBoardClicked();
                break;
              default:
            }
          },
          itemBuilder: (context) {
            return [
              const PopupMenuItem<String>(
                  value: "SaveBoard", child: Text("Save Board")),
              const PopupMenuItem<String>(value: "About", child: Text("About")),
            ];
          },
        )
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _createSceneTopBar(),
      body: const BulletinBoardScene(),
    );
  }
}

/// Represents the home UI widget.
///
/// It contains all of the child widget that the user can tap or interact with.
/// It builds up the main user interface.
class AstaliAppHome extends StatefulWidget {
  const AstaliAppHome({super.key});

  @override
  State<AstaliAppHome> createState() => _AstaliAppHomeState();
}

/// Represents the main state of the AstaliAppHome widget.
///
/// Builds up the main user interface.
class _AstaliAppHomeState extends State<AstaliAppHome> {
  @override
  Widget build(BuildContext context) {
    return AstaliAppHomePresentation(
      commonCallbacks: ScenesCommonCallbacks(
          onAboutButtonClicked: _onAboutItemClicked,
          onSaveBoardClicked: _onSaveBoardClicked),
    );
  }

  void _onAboutItemClicked() {
    showAstaliAboutDialog(context);
  }

  void _onSaveBoardClicked() {}
}
