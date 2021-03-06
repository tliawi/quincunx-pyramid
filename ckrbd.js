/*
ckrbd.js

Copyright 2018 John R C Fairfield, see MIT License
    
Download, and put the two files index.html and ckrbd.js in a folder (directory) and
open index.html in the Chrome browser.
*/

// ckrbd creates a checkerboard (quincunx) pyramid covering the canvas, and returns an object of methods
// to manipulate and display the pyramid
function ckrbd(imgCanvas) {

var imgContext = imgCanvas.getContext("2d");
imgContext.globalAlpha = 1; //no transparency  
var imgData = imgContext.getImageData(0, 0, imgCanvas.width, imgCanvas.height);

var rgba = imgData.data;
var imageWidth = imgCanvas.width;
var imageHeight = imgCanvas.height;

var pyrHeight = imageHeight+1;
var pyrWidth = imageWidth+1;

// Terminology:
// Think in three levels: canvas rgba, image, and pyr (for pyramid).
// The canvas "rgba" is used to make a display of the data in
// a 2 dimensional array called the "image". 
// Image is overlayed by a two dimensional array called "pyr" which
// represents the checkerboard pyramid.
// To avoid confusion, elements of rgba are called "pixels",
// elements of image are called "cells", 
// and elements of pyr are called "nodes".
    
// Image forms the foundation of pyr, underneath level 0 of pyr.
// In a significant way, image is level -1 of pyr.

var dots; //array of {i:, j:} dots in pyr coordinates
    
var image = [imageHeight]; //image is a two dimensional array of cell values
for (let i=0;i<imageHeight;i++) image[i] = (new Array(imageWidth)).fill(0);
    
// Two dimensional structures (image and pyr) are indexed in row major order (i.e. row, column) 
// with the origin in the upper left corner, 
// positive going down (in rows) and to the right (in cols).
    
// An image of size [r,c] can be used to visualize content in a
// pyramid of size [r+1,c+1].
// Imagine a grid of r+1 horizontal lines crossing c+1 vertical lines.
// Think of the pyramid nodes as occupying the (r+1)*(c+1) intersections,
// while the image cells occupy the r*c squares.
// Nodes are at levels >= 0, and the image cells can be thought of as being pyramid level -1.
    
// The center of cell i,j (image[i][j]) is at position 
// i-0.5, j-0.5 in pyramid coordinates.
    
// The values in both image and pyr are integers.

var pyr = [pyrHeight];
for (let i=0;i<pyrHeight;i++) pyr[i] = (new Array(pyrWidth)).fill(0);

// Some of this code (footprint, headprint) is written under the SUMS assumption that each pyr node or image cell value is 
// an integer with a default value of 0.
// Some of this code (closest point, Delaunay-like, Voronoi-like) is written 
// under the POINTS assumption that each pyr node or image cell value is
// an integer k that if zero represents no dot, or if >0 represents the dot dots[k].

// Note that dots[0] is never used, it's throwaway so that k's are "truthy"
// and 0 can represent the empty set.

// If there are multiple dots having the same image coordinates, they are treated as one dot--this code does not
// examine below the pixel level.
    
//Section 1. This first section of code is independent of the distinction SUMS|POINTS ------------------------------

//1.a Clearing
    
function clearImage(z=0){
    for (let i=0; i<imageHeight;i++) for (let j=0; j<imageWidth;j++) image[i][j]=z;
}
    
function clearPyr(z=0){
    for (let i=0;i<pyrHeight;i++) for (let j=0;j<pyrWidth;j++) pyr[i][j] = z; 
}

function clearRGBA(){
    for (let i=0;i<imageHeight;i++) for (let j=0;j<imageWidth;j++)  {
            let ix = 4*(i*imageWidth + j);
            rgba[ix] = 0;
            rgba[ix+1] = 0;
            rgba[ix+2] = 0;
            rgba[ix+3] = 0xff;
    }
}
    
function clearContext(){
    imgContext.fillStyle = "rgba(255, 255, 255, 1.0)";
    imgContext.fillRect(0,0,imageWidth,imageHeight);
}

// 1.b  Distances
    
// Horz or vert distance between child at given level 
// and either of its parents at level+1
// Valid for positive or negative levels, 
// for level = -1 returns 0.5, the delta (in both H and V)
// from the pyramid grid intersections (nodes)
// to the centers of the cells between.
function hvDistToParent(level){
    return Math.pow(2, Math.floor(level/2));
}

function hvDistBetweenSibs(level){
    return hvDistToParent(level+2);
}
    
// d2 means distance squared.
function d2(i1,j1,i2,j2){
    var di = i1-i2;
    var dj = j1-j2;
    return di*di+dj*dj;
}

//valid for lvl >= 0
//lvl is level of parent
function d2BetweenAdjacentChildren(lvl){ //d2BetweenOppositeChildren is twice as much
    return 1<<lvl;
}
    
function d2ToChildren(lev){
    return d2BetweenAdjacentChildren(lev)/2;
}

function d2BetweenAdjacentSiblings(lvl){ return d2BetweenAdjacentChildren(lvl+1);}

//lvl is level of parent
//The radius^2 of the level 0 footprint of a child (a level lvl-1 node)
//(radius being half the distance between opposing longer faces of the octagon)
//is d2BetweenOppositeChildren(lvl)
function d2BetweenOppositeChildren(lvl){ //d2BetweenAdjacentChildren is half as much
    return 1<<(lvl+1);
}
    
function d2BetweenOppositeSiblings(lvl){return d2BetweenOppositeChildren(lvl+1);}
    
// 1.c Level

// Here i and j are node coordinates
// This function returns the pyramid level of the given node, up to a limit of level 100.
// Given that by far most nodes are low level, on average it's not as inefficient as it looks.
// Note this function is not used by indexALevel, which directly computes indices to all nodes of a given level
// with no recursion.
function level(i, j) {
  var lvl;
  for (let lvl = 0; lvl < 100; lvl++) {
    var k = lvl % 2 ? i : i + j; //odd versus even levels
    k = k / hvDistToParent(lvl);
    if (k % 2) return lvl;
  }
  return lvl; //this is the case for 0,0.
}

// 1.d Top Down ----------

//Here i,j are usually coordinates of a level 0 node.
//The returned coordinates (up to 4 of them) are within the image,
//which has one less row and column. They identify the 4 cells which share
//the pyramid intersection (vertex), i.e. can be thought of as level -1 children of
//the level 0 node. 
//(cellChildren can actually be called for any node (not just level 0 nodes),
// which is useful for "marking" positions of desired higher level nodes on the image.
// Regardless, the returned coordinates are image coords, not pyramid coords.)
// That everything be consistent order (cwise or ccwise) is important to wrap and complementary sources.
function cellChildren(i,j) {
 var r = [];
 if ( i > 0 && j < imageWidth ) r.push(           { i: i-1, j:j,   p:1} );
 if ( i > 0 && j > 0) r.push(                     { i:i-1,  j:j-1, p:3} );
 if ( i < imageHeight && j > 0 ) r.push(          { i: i,   j:j-1, p:5} );
 if ( i < imageHeight && j < imageWidth ) r.push( { i:i,    j:j,   p:7} );
 return r;
}

//opposite/adjacent parity, based on position,
//how a child relates to siblings, by adjacency (different parity)
//or in opposition (same parity)


//      1           0   1            3 2 1
//    0   0                          4   0
//      1           1   0            5 6 7           
    
//returns an array of 0-4 pyramid coordinates {i:i,j:j,p:position}
// ccwise order important to wrap
function children(i,j,level) {
  var r = [];
  if (level<=0) return r;
    
  var d = hvDistToParent(level-1);
  
  if (level & 1) { //rooky
    if (j+d < pyrWidth) r.push(  { i:i,   j:j+d, p:0} );
    if (i-d >= 0) r.push(        { i:i-d, j:j,   p:2} );
    if (j-d >= 0) r.push(        { i:i,   j:j-d, p:4} );
    if (i+d < pyrHeight) r.push( { i:i+d, j:j,   p:6} ); 
  } else { //bishopy
    if (i-d >= 0 && j+d < pyrWidth ) r.push(        { i:i-d, j:j+d, p:1} );
    if (i-d >= 0 && j-d >= 0 ) r.push(              { i:i-d, j:j-d, p:3} );
    if (i+d < pyrHeight && j-d >= 0 ) r.push(       { i:i+d, j:j-d, p:5} );
    if (i+d < pyrHeight && j+d < pyrWidth ) r.push( { i:i+d, j:j+d, p:7} );
  }
  return r;
}

    
// 1.e Bottom Up  ----------------
    
// Bottom up is different from top down. Top down stats can be collected in 
// the leaves == the bottommost layer == the image,
// while the uninstantiated pyramid is virtually searched by dfs on calculated indices.
// Bottom up stats need to be collected not just in the leaf (topmost) layer, 
// but on intermediate layers,
// since you don't know what the topmost layer will be. 

// Remembering that the origin is in top left corner,
// if (i+j) is odd, the parents of cell (pixel) i,j are the NW and SE nodes
// (the NW and SE corners of cell (i,j)),
// if even, the parents are NE and SW.

// The parameter is in image (cell) coordinates.
// The returned coordinates are the pyramid coordinates
// of two nodes in level 0 of the pyramid,
// which has an extra row and column, so no out-of-bounds checking is needed.
function cellsLevel0Parents(i,j) {
    if ((i+j)%2) { 
      return [  { i:i,   j:j   },
                { i:i+1, j:j+1 }  ];
    } else { 
      return [  { i:i+1, j:j   },
                { i:i,   j:j+1 }  ];
    }
}

/*
The relationship between a child and its parents is either of type + or x (crosstype + or x, rooky or bishopy),
and within + is either | or —, and within x is either / or \ (orientation |, —, /, or \).
Within a level, all relationships to the parent level have the same crosstype.
Within a level, nodes have the same crosstype but can have two different orientations.
Neighboring levels have different crosstypes.
Having chosen that image to level zero would be x, we have
-1 (image) to level 0 x
0 to 1 +
1 to 2 x 
2 to 3 +
3 to 4 x
4 to 5 +
etc.
 
Note that all nodes of a given EVEN level within a given ROW of constant i 
(or column of constant j) have the same orientation ( | or — ),
and alternating such rows have alternating orientations.

Note that all nodes of a given ODD level within a given DIAGONAL of constant i+j
(or constant i-j) have the same orientation ( / or \ )
and alternating such diagonals have alternating orientations. 

Function parents(i,j,level) returns the parents of a given node having the given level
Parents is based on i, j, k = hvDistToParent(level+1), and d = hvDistToParent(level).

Crosstype +, even levels
level  k     i multiples of k           | even multiples   — odd multiples
  0    1      0, 1, 2, ...                   0,2,4..           1,3,5..      
  2    2      0, 2, 4, ...                   0,4,8..           2,6,10..      
  4    4      0, 4, 8, ...                   0,8,16..          4,12,20..     
  6    8      0, 8, 16, ...                  0,16,32           8,24,40       
 
Crosstype x, odd levels
level  k     (i+j) multiples of k       \ even multiples    / odd multiples
 -1    1      1, 2, 3, ...                   2,4,6..          1,3,5..
  1    2      2, 4, 6, ...                   4,8,12..         2,6,10..
  3    4      2, 6, 10, ...                  8,16,24..        4,12,20..
  5    8      4, 12, 20, ...                 16,32,48..       8,24,40..
 
 (0 doesn't appear as a multiple of (i+j) only because the sole such node, (0,0), has no level)
 
 */
const SLANTUP = 0, SLANTDOWN = 1, HORIZONTAL = 2, VERTICAL = 3; //   /  \  —  |

function parents(i,j,level) {
  var d = hvDistToParent(level);
  var k = hvDistToParent(level+1);
    
  var orientation;
  if (level%2){     // odd, so crosstype x
      if (((i+j)/k)%2) orientation = SLANTUP;    // (i+j) an odd multiple of k, /
      else             orientation = SLANTDOWN;  // (i+j) an even muliple of k, \
  } else {          // even, so crosstype +
      if ((i/k)%2)     orientation = HORIZONTAL; // i an odd multiple of k,  |
      else             orientation = VERTICAL;   // i an even multiple of k, —
  }
  
// Signed orientation (moment) could indicate direction from child to parent
//   -D +V +U       3  2  1      8   4   2
//   -H    +H       4     0      16      1
//   -U -V +D       5  6  7      32  64 128
  var r = [];
  switch (orientation){
      case VERTICAL:  
          if (i-d >= 0)        r.push( { i:i-d, j:j    } );
          if (i+d < pyrHeight) r.push( { i:i+d, j:j    } );
          break;
      case HORIZONTAL: 
          if (j-d >= 0)        r.push( { i:i,   j:j-d  } );
          if (j+d < pyrWidth)  r.push( { i:i,   j:j+d  } );
          break;
      case SLANTUP: 
          if (i+d < pyrHeight && j-d >= 0)
                               r.push( { i:i+d, j:j-d  } );
          if (i-d >= 0 && j+d < pyrWidth )
                               r.push( { i:i-d, j:j+d  } );
          break;
      case SLANTDOWN:
          if (i-d >= 0 && j-d >= 0)
                               r.push( { i:i-d, j:j-d  } );
          if (i+d < pyrHeight && j+d < pyrWidth) 
                               r.push( { i:i+d, j:j+d  } );
          break;
  }
    
  return r;

}

// 1.f Indexing through the pyramid
    

var indexLevel;

//Parameter “visit” below is a callback parameter, it must be a function 
//that itself takes parameters (i,j,level).
//It implements whatever one wants to do when “visiting” a node.
//It must return 0 if it finds no evidence that
//work on a subsequent level needs to be done, else some positive number.
    
//Function indexALevel calls visit for every node in a given level.  
function indexALevel(visit,level){
    
    let dsibs = hvDistBetweenSibs(level);
    let halfdsibs = dsibs>>1;
    let goOn = 0;

    if (level&1){ //odd
        for (let i=halfdsibs; i<pyrHeight; i+=dsibs)
            for (let j=halfdsibs; j<pyrWidth; j+=dsibs) 
                goOn += visit(i,j,level);
    } else { //even
        for (let i=0; i<pyrHeight; i+= halfdsibs) {
            for (let j=((i/halfdsibs)&1)?0:halfdsibs; j<pyrWidth; j+=dsibs)
                goOn += visit(i,j,level);  
        }
    }
    
    return goOn;
}

//calls visit(i,j,level) on every node of level >= given level >= 0
function indexGELevel(visit,level){
    let grndLevel = level-1;
    let dsibs = hvDistBetweenSibs(grndLevel);
    let halfdsibs = dsibs>>1;
    let goOn = 0;

    if (grndLevel&1){ //odd
        for (let i=0; i<pyrHeight; i+=dsibs)
            for (let j=0; j<pyrWidth; j+=dsibs) 
                goOn += visit(i,j,level);
    } else { //even
        for (let i=0; i<pyrHeight; i+= halfdsibs) {
            for (let j=((i/halfdsibs)&1)?halfdsibs:0; j<pyrWidth; j+=dsibs)
                goOn += visit(i,j,level);  
        }
    }
    
    return goOn;
}

    
//Indexes through the whole pyramid hitting first all nodes at level botLevel, then level botLevel+1, level botLevel+2, etc..
//IndexUp quits when an entire level finishes with no evidence 
//that work on higher levels needs to be done, or when it has finished level topLevel (leaving indexLevel = topLevel+1)
function indexUp(visit, botLevel, topLevel){
    for (indexLevel = botLevel;indexLevel<=topLevel;indexLevel++){
        if (indexALevel(visit,indexLevel)==0) return;
    }
}

//Indexes through the whole pyramid hitting first all nodes at level topLevel, then level topLevel-1,  etc..
//IndexDn quits when an entire level finishes with no evidence 
//that work on lower levels needs to be done, or when it has finished level botLevel (leaving indexLevel = botLevel-1)
function indexDn(visit, topLevel, botLevel){
    for (indexLevel = topLevel;indexLevel>=botLevel;indexLevel--){
        if (indexALevel(visit,indexLevel)==0) return;
    }
}
    
function indexUpGE(visit,botLevel,topLevel){
    for (indexLevel = botLevel;indexLevel<=topLevel;indexLevel++){
        if (indexGELevel(visit,indexLevel)==0) return;
    }
}

function indexDnGE(visit, topLevel, botLevel){
    for (indexLevel = topLevel;indexLevel>=botLevel;indexLevel--){
        if (indexGELevel(visit,indexLevel)==0) return;
    }
}
    
// Section 2. SUMS -------------------------------------------------------------------------------------------------------

// 2.a implicit SUMS
    
// In this section pyr is not used. Rather the pyramid is 'searched' implicitly using pyr coordinates without ever referring
// to pyr contents.
    
// The following function puts the weighted footprint of a given node into image.
    
// lvl must be level(i,j), implying it will always be >=0
// Counts the number of ways dfs can get to each cell from a given node.
function depthFirstMarkup(i, j, lvl){
    if (lvl == 0) {
        cellChildren(i,j).forEach(cell => {image[cell.i][cell.j]++;});
    } else {
        children(i,j,lvl).forEach(node => { depthFirstMarkup(node.i, node.j, lvl-1); });
    }
}

// The following pair of functions put the weighted headprint of a particular cell into image.
    
// Mark image around all toplevel sites with the number of ways that height fs can get to them from
// cell (iImage, jImage), which are coordinates of an image cell.
function cellHeightFirstMarkup(iImage,jImage,topLevel){
    if (topLevel >= 0) {
    cellsLevel0Parents(iImage,jImage).forEach(node=>heightFirstMarkup(node.i,node.j,0,topLevel));
    }
}
    
// Mark all nodes with the number of ways that height fs can get to them from
// the node given in i,j, which is coordinates of a pyramid intersection, not an image cell.
// lvl must be level(i, j), and must be <= topLevel
function heightFirstMarkup(i, j, lvl, topLevel){
    if (lvl >= topLevel) {//mark surrounding image
        cellChildren(i,j).forEach(cell=> { 
            image[cell.i][cell.j]++;
        }); 
    } else {
        parents(i,j,lvl).forEach(node=>heightFirstMarkup(node.i, node.j, lvl+1, topLevel));
    }
}


// 2.b SUM visits ///////////////

    
//childlvl must be >=0, doesn't work on image
function hopUp(i,j,childlvl){
    if (pyr[i][j] < 9999) { 
        parents(i,j,childlvl).forEach(parent=>{pyr[parent.i][parent.j] = pyr[i][j]+1;});//==childlvl+2 ==level(parent.i,parent.j)+1
        return pyr[i][j];
    } else return 0;
}

function hopDn(i,j,lvl){
    if (pyr[i][j] < 9999) {
        if (lvl==0) cellChildren(i,j).forEach(cell=> image[cell.i][cell.j] = Math.min(pyr[i][j]+1, image[cell.i][cell.j]) );
        else children(i,j,lvl).forEach(child=> pyr[child.i][child.j] = Math.min(pyr[i][j]+1, pyr[child.i][child.j]) );
        return lvl;
    }
    else return 0;
}

// i,j in image coordinates
function hopImage(i,j){
    clearImage(9999);
    clearPyr(9999);
    clearRGBA();
    
    //seed level 0
    image[i][j] = 0;
    cellsLevel0Parents(i,j).forEach(parent=>{ pyr[parent.i][parent.j] = 1; }); //==level(parent.i,parent.j) + 1
                        
    indexUp(hopUp,0,100);
    console.log(indexLevel);
    indexDn(hopDn,indexLevel-1,0); //not indexLevel-1, shifting from childlvl up to parent lvl down
    
    renderImageToRGBA();
}

//take advantage of fact that headprint never has more than 7 nodes
function intersection(a,b){
    if (a.length && b.length) {
        for (let n=0;n<a.length;n++) 
            for (let m = 0;m<b.length;m++) if (a[n].i == b[m].i && a[n].j == b[m].j) return true;
    }
    return false;
}
    
function parentsOf(cin,level) {
    var cout = [];
    cin.forEach(node=>parents(node.i,node.j,level).forEach(parent=>{
        if (!intersection(cout,[parent])) cout.push(parent);
    }));
    return cout;
}
    
function hopDistance(i,j,ii,jj){
    
    if (i==ii && j==jj) return 0;
    
    //if they meet on parents of level -1 == level 0, then (-1+2)*2 = two hops (one up, one down)
    var c1 = cellsLevel0Parents(i,j);
    var c2 = cellsLevel0Parents(ii,jj);
    if (intersection(c1,c2)) return 2;
    
    //if they meet on parents of level levl = level levl+1, then (levl+2)*2 hops
    for (var levl = 0;true;levl++) {
        c1 = parentsOf(c1,levl);
        c2 = parentsOf(c2,levl);
        if (c1.length * c2.length == 0) return 0;
        if (intersection(c1,c2)) return (levl+2)*2;
    }
}

//as verification of hopDistance, a much slower way of calculating hopImage(i,j), results should be identical.
function hopImage2(i,j){
    for (var ii = 0; ii<imageHeight; ii++) {
        for (var jj = 0; jj<imageWidth; jj++) image[ii][jj] = hopDistance(i,j,ii,jj);
    }
    renderImageToRGBA();
}

//sums hops between i,j and 100 random nodes in window whose top left is si,sj and of width==height = slength
function sumHopDistance(i,j,si,sj,slength,shotSize) {
    var sum=0;
    for (var n=0;n<shotSize;n++) sum += hopDistance(i,j,si+Math.floor(Math.random()*slength),sj+Math.floor(Math.random()*slength) );
    return sum;
}
    
function avgHopDistance(i,j,si,sj,siLength,sjLength){
    var sum=0;
    for (var ii=si;ii<si+siLength;ii++) for (var jj=sj;jj<sj+sjLength;jj++) sum += hopDistance(i,j,ii,jj);
    return sum/(siLength*sjLength);
}
    
//a visit, for calculating weighted headprints
function incParents(i,j,lvl){
  if (pyr[i][j]){ 
      parents(i,j,lvl).forEach(node=>{
          pyr[node.i][node.j] = pyr[node.i][node.j]?pyr[node.i][node.j] + pyr[i][j] : pyr[i][j];
      });
      return 1;
  } else return 0;
}

//a visit, for calculating weighted footPrints
function incrementKids(i,j,level){
    if (pyr[i][j]) {
        if (level == 0) cellChildren(i,j).forEach(cell=> {image[cell.i][cell.j] += pyr[i][j];} );
        else children(i,j,level).forEach(child=> { pyr[child.i][child.j] += pyr[i][j]; });
        return 1;
    } else return 0;
}

// functions as a visit, though it doesn't use level
function clearnode(i,j){
    pyr[i][j] = 0;
    return 1; // always truthy
}

//2.c SUM entry points

//Entry point for footprint of a given node.
//cb.footprint(320,320) has the same effect on image as cb.depthFirstMarkup(320,320,level(320,320)), 
//but uses pyr values and indexing with a visit function, rather than implicit dfs.
//(You have to follow with cb.renderImageToRGBA() to see the results).
//For higher level nodes footprint() is a ton faster than depthFirstMarkup().
function footprint(i,j){
    clearImage();
    clearPyr();
    clearRGBA();
    
    pyr[i][j] = 1;
    indexDn(incrementKids, level(i,j), 0);
}   


//Entry point for plusLevel headprints of givendots. To see results, follow with portrayLevel(plusLevel)
function headprints(givenDots, plusLevel){ 
    if (plusLevel <0) return;
    dots = givenDots;
    clearImage();
    clearPyr();
    clearRGBA();
    
    //seed level 0
    for (let km=1;km<dots.length;km++) cellsLevel0Parents(Math.floor(dots[km].i), Math.floor(dots[km].j)).forEach(node=>{
        pyr[node.i][node.j]++;
    });
                        
    indexUp(incParents,0,plusLevel);
}    
    

//Entry point for continuous plusLevel footprints of givenDots. An up/up/down algorithm
function footprints(givenDots, plusLevel){
    headprints(givenDots, plusLevel); //bottom up
    indexUp(clearnode, 0, plusLevel-1); //clear everything except weighted headprint on plusLevel
    indexDn(incrementKids,plusLevel,0);
}
    
    
//Section 3. POINTS -------------------------------------------------------------------------------------------------


// 3.a SET infrastructure
    
function unionKs(aKs,bKs){
    var u = aKs.slice();
    bKs.forEach(k=>{ if(u.indexOf(k)<0)u.push(k); });
    return u;
}

//Set adds k to kSet. Returns kSet
function addKTo(k, kSet){
    if (kSet.indexOf(k)<0) kSet.push(k);
    return kSet;
}

// adds all ks in givesKs to getsKs. Returns getsKs.
function addKsTo(givesKs,getsKs){
    givesKs.forEach(k=>addKTo(k,getsKs));
    return getsKs;
}
    


//Assumes dotKs.length >= 1.
//Returns {d2:distance from i,j to closest dot, m:index in dotKs of first closest dot, k: k of that dot}
function minD2(i,j,dotKs){
    var mnM = 0;
    var mnD2 = d2(i,j,dots[dotKs[0]].i,dots[dotKs[0]].j);
    
    for (let m=1;m<dotKs.length;m++) {
        let d = d2(i,j,dots[dotKs[m]].i,dots[dotKs[m]].j);
        if (d<mnD2) { mnD2 = d; mnM = m; }
    }
    
    return {d2:mnD2, m:mnM, k:dotKs[mnM]};
}

var closestDisplay = 1; //falsy, values are 0 (none), 1 (closest), or 8 (closest in 8 directions)
    
//a visit, for closest dot precursor to Voronoi.
function taprootClosest(i,j,topLevel){
    
    var dotKs = [];
    
    //Level 0 gets special treatment because sources are all in image, not pyr
    cellChildren(i,j).forEach(cell => {
        if (image[cell.i][cell.j]) addKTo(image[cell.i][cell.j],dotKs); 
        //all image dot ks > 0 are different, unblocked.
    });
    
    // firstLev is first level where something is found,
    // do one more level (if possible) thus adding in the closest dot in any of all 8 directions.
    var firstLev = dotKs.length?0:1000;
    for (let lev = 1;lev<=topLevel;lev++) {
        children(i,j,lev).forEach(child => {
            let k = pyr[child.i][child.j];
            if (k) {
                if (closestDisplay==8) drawBetween(i,j,dots[k].i,dots[k].j,randomRGBString(i*pyrWidth+j));
                addKTo(k,dotKs);
            }
        });
        if (lev == firstLev + 1) break; // have added in closest in each of 8 directions examined
    }
    
    if (dotKs.length) {
        pyr[i][j] = minD2(i,j,dotKs).k;
        if (closestDisplay == 1) { 
            let d = dots[pyr[i][j]];
            drawBetween(i,j,d.i,d.j,randomRGBString(i*pyrWidth+j)); 
        }
        return 1;
    } else return 0;
}
    
//a visit, for second part of Voronoi after closest dot.
function taprootRedux(i,j,topLevel){
    
    var k = pyr[i][j];
    if (k){
        for (let lev = topLevel;lev>0;lev--) { //go down (or up, doesn't matter) taproot, spreading info about k
            children(i,j,lev).forEach(child => {
                let ck = pyr[child.i][child.j]; //by assumption of reduction, is 0 or a positive k
                if (ck == 0) pyr[child.i][child.j] = k;
                else {
                    let d2K = d2(child.i,child.j,dots[k].i,dots[k].j);
                    let d2Ck = d2(child.i,child.j,dots[ck].i,dots[ck].j)
                    if (d2K < d2Ck) pyr[child.i][child.j] = k;
                }
            });
        }
        
        //level 0 gets special treatment
        cellChildren(i,j).forEach(cell => {
            let ck = image[cell.i][cell.j];
            if (ck == 0) image[cell.i][cell.j] = k;
            else {
                let d2K = d2(cell.i,cell.j,dots[k].i,dots[k].j);
                let d2Ck = d2(cell.i,cell.j,dots[ck].i,dots[ck].j)
                if (d2K < d2Ck) image[cell.i][cell.j] = k;
            }
        });
        
        return 1;
    } else return 0;
}

//a visit, for second part of Voronoi after closest dot.
function GERedux(i,j,levl){
    
    var k = pyr[i][j];
    
    if (k){
        if (levl == 0) {//level 0 gets special treatment
            
            cellChildren(i,j).forEach(cell => {
                let ck = image[cell.i][cell.j];
                if (ck == 0) image[cell.i][cell.j] = k;
                else {
                    let d2K = d2(cell.i,cell.j,dots[k].i,dots[k].j);
                    let d2Ck = d2(cell.i,cell.j,dots[ck].i,dots[ck].j)
                    if (d2K < d2Ck) image[cell.i][cell.j] = k;
                }
            });
            
        } else {
            
            children(i,j,levl).forEach(child => {
                let ck = pyr[child.i][child.j];
                if (ck == 0) pyr[child.i][child.j] = k;
                else {
                    let d2K = d2(child.i,child.j,dots[k].i,dots[k].j);
                    let d2Ck = d2(child.i,child.j,dots[ck].i,dots[ck].j)
                    if (d2K < d2Ck) pyr[child.i][child.j] = k;
                }
            });
            
        }
        
        return 1;
    } else return 0;
}
    
//a visit
function GEClosest(i,j,levl){
    
    var bestK = pyr[i][j];
    var bestD2 = Number.MAX_VALUE;
    
    function updateBest(thisK){
        if (thisK){
            if (bestK==0) bestK = thisK;
            else {
                if (bestD2 == Number.MAX_VALUE) bestD2 = d2(i,j,dots[bestK].i,dots[bestK].j);
                let thisD2 = d2(i,j,dots[thisK].i,dots[thisK].j);
                if (thisD2 < bestD2) {
                    bestD2 = thisD2;
                    bestK = thisK;
                }
            }
        }
    }
        
    //Level 0 gets special treatment because sources are all in image, not pyr
    if (levl == 0) cellChildren(i,j).forEach(cell => updateBest(image[cell.i][cell.j]) );
    else children(i,j,levl).forEach(child => updateBest(pyr[child.i][child.j]) );
    
    if (bestK && bestK != pyr[i][j]) {
        pyr[i][j] = bestK;
        if (closestDisplay == 1) drawBetween(i,j,dots[bestK].i,dots[bestK].j,cyclicColor(levl)); // randomRGBString(levl));//levl*(i*pyrWidth+j)
        return 1;
    } else return 0;
    
}
    
//for voronoi-based Delaunay, used only on level 0
//does not use pyr, only image
//examines a level 0 node's children, given that Voronoi has already defined all cells
function DelaunayFromVoronoi(i,j){
    var dotKs = [];
    cellChildren(i,j).forEach(cell => addKTo(image[cell.i][cell.j],dotKs));
    if (dotKs.length>1) wrap(dotKs);
}


          
// 3.b POINT entry points 
    
//seed image with truthy dot locations. Overwrites multiple dots at same location.
function seedImage(givenDots){
   
    dots = [ {i:0,j:0}]; //first one will be ignored
    for (let k=1;k<givenDots.length;k++){
        //note: if multiple dots land in the same cell this retains only the last one.
        //Arguably one should retain the one closest to the midpoint of the cell.
        image[Math.floor(givenDots[k].i)][Math.floor(givenDots[k].j)] = k;
        dots.push({i:givenDots[k].i+0.5, j:givenDots[k].j+0.5}); //save dots in pyr coordinate framework
    } 
}
 

//Entry point for closest dot
function closestDot(givenDots){
    clearImage();
    clearPyr();
    clearRGBA();
    clearContext();
    
    seedImage(givenDots);
    //indexUp(taprootClosest, 0, 100);
    indexUpGE(GEClosest,0,100);
}

function pyrVoro(givenDots){
    closestDisplay = 0; //turn off closestDot display
    closestDot(givenDots);
    closestDisplay = 1;

    //indexDn(taprootRedux, indexLevel-1,0);
    indexDnGE(GERedux, indexLevel-1,0);
}

//Entry point for Voronoi-like
function voronoi(givenDots, standard){
    
    if (standard) flatVoro(givenDots);
    else pyrVoro(givenDots);
    
    renderImageKs();
}

//Entry point for Delaunay-like
function delaunay(givenDots, standard){
    voronoi(givenDots, standard);
    indexALevel(DelaunayFromVoronoi,0);
}
    
    
// Non pyramid 4 pass standard voronoi calculation -----------------------------------------------------------
    
function flatVoro(givenDots){
    clearImage();
    clearRGBA();
    clearContext();
    
    seedImage(givenDots);
    sweep4(); //propagates ks through image
}
    
function sweep4(){
    
    var k;
    
    function update(i,j){
        let localK = image[i][j];
        if (localK) {
            if (d2(dots[k].i,dots[k].j,i,j) < d2(dots[localK].i,dots[localK].j,i,j)) image[i][j] = k;
        } else image[i][j] = k;
    }
    
    for (let i=0;i<imageHeight-1;i++)for (let j=0;j<imageWidth-1;j++){
        k = image[i][j];
        if (k){
            update(i,  j+1); 
            update(i+1,j  ); 
            update(i+1,j+1);
        }
    }
    
    for (let i=imageHeight-1;i>0;i--) for (let j=imageWidth-1;j>0;j--){
        k = image[i][j];
        if (k){ 
            update(i,  j-1); 
            update(i-1,j  ); 
            update(i-1,j-1);
        }
    }
    
    for (let i=imageHeight-1;i>0;i--) for (let j=0;j<imageWidth-1;j++){
        k = image[i][j];
        if (k){ 
            update(i-1, j  ); 
            update(i-1, j+1); 
            update(i,   j+1);
        }
    }
    
    for (let i=0;i<imageHeight-1;i++) for (let j=imageWidth-1;j>0;j--){
        k = image[i][j];
        if (k){ 
            update(i,   j-1); 
            update(i+1, j  ); 
            update(i+1, j-1);
        }
    }
}

    
// Visualizations and tests  ____________________________________________________________________________________
    
function testPyrCoords(i,j){
    if (!(i>=0)) { console.log('XXX i '+i); }
    if (!(j>=0)) { console.log('XXX j '+j); }
    if (!(i<pyrHeight)) { console.log('YYY i '+i); }
    if (!(j<pyrWidth)) { console.log('YYY j '+j); }
}
    
function testChildren(){
    for (let i=0;i<pyrHeight;i++) for (let j=0;j<pyrWidth;j++) 
        children(i,j,level(i,j)).forEach(child => testPyrCoords(child.i,child.j));
}
    
function testNeighbors(i,j){
    var lev = level(i,j);
    var nbors = children(i,j,lev+2);
    nbors.forEach(child=> {
        if (level(child.i,child.j)!=lev ) console.log("wrong level neighbors "+child.i+','+child.j);
        else console.log("same level neighbors "+child.i+','+child.j);
    });
}

function testParents(){
    for (let i=0;i<pyrHeight;i++) for (let j=0;j<pyrWidth;j++) 
        parents(i,j,level(i,j)).forEach(parent => testPyrCoords(parent.i,parent.j));
}

//a visit, to portray in image, a pyr node
function markImage(i,j,level){
    if (pyr[i][j]) cellChildren(i,j).forEach(cell => { image[cell.i][cell.j] = pyr[i][j];} ); //mark surrounding image
}

function portrayLevel(level){
    indexALevel(markImage,level);
}
    
    
function markVisit(i,j,level){
    cellChildren(i,j).forEach(cell=> { 
            image[cell.i][cell.j]++;
        })
}
    
function testGELevel(level){
    clearImage();
    clearPyr();
    clearRGBA();
    clearContext();
    
    indexGELevel(markVisit,level);
    renderImageToRGBA();
}
 
//returns sum of levels of nodes in a square pyramid width. 
//For reg pyr, use width = 1 plus a power of two
function sumLevels(width){
    var r = 0;
    for (let i=0;i<width;i++){
        for (let j=0;j<width;j++){
            if (i >0 || j>0) r+= level(i,j);
        }
    }
    return r;
}

    
function sumImage(){
    var count = 0;
    for (let i=0;i<imageHeight;i++)for (let j=0;j<imageWidth;j++) count+= image[i][j];
    return count;
}


function magnitude(numArr){ //numArr a one dimensional numeric array
    return Math.max(Math.max(...numArr), -Math.min(...numArr));
}

// clobbers rgba, a global r,g,b,alpha linear canvas data array visualizing the numeric data 
// in a given complete two dimensional numeric Array (usually the image, level -1).
// Numeric values are rendered in a spectrum 
// from green (positive) to grey (zero) to red (negative).
function renderImageToRGBA(threshold=9999999999,numArr=image){
    const GREYVAL = 64;
    var height = numArr.length, width = numArr[0].length;
    
    // find greatest magnitude, to normalize with
    var mag = 0;
    for (let i=0;i<height;i++) mag = Math.max(mag,magnitude(numArr[i]));
    if (mag==0) mag = 1; //avoid zerodivide in toxic all-zero case
    //console.log("magnitude "+mag);
    
    //normalize very differently if threshold is so small that unit differences will be clearly distinguishable.
    if (threshold <= 10) mag = threshold;
    
    //rgba is linear canvas rgba data array of integer 0-255 values
    
    for (let i=0;i<height;i++){
        for (let j=0;j<width;j++){
            let ix = 4*(i*width + j);
            let num = numArr[i][j];
            if (num<0) {
                num = num < -threshold? -threshold: num;
                rgba[ix]   = Math.floor(((255-GREYVAL)*(-num))/mag) + GREYVAL; //red negative
                rgba[ix+1] =  GREYVAL;   //green
            } else {
                num = num > threshold? threshold: num;
                rgba[ix]   =  GREYVAL;   //red
                rgba[ix+1] = Math.floor(((255-GREYVAL)*num)/mag) + GREYVAL; //green positive
            }
            rgba[ix+2] = GREYVAL; //blue
            rgba[ix+3] = 255; //alpha
        }
    }
    
    imgContext.putImageData(imgData, 0, 0);
}
    

//a and b are objects {i:int, j:int} containing image coordinates
function dumpLine(a,b){
    stLine(a,b).forEach(cell => console.log(image[cell.i][cell.j]));
}
    
//returns integer coordinates of a (discrete 4-neighbor closest approximation to)
//straight line between 2D points a and b, each an object {i:int, j:int}.
//The returned line begins with a and ends with b.
function stLine(a, b){
    
    //for (var index=0; true; index++) print( dither(p,index) );
    //produces a sequence of 0's and 1's, where the probability of 1's is p, and the 1's are 
    //uniformly dithered, that is, they are spread out as uniformly as possible.
    function dither(p,index) { return Math.floor((index+1)*p) == Math.floor(index*p)?0:1; }
    
    var di = a.i < b.i? 1:-1;
    var dj = a.j < b.j? 1:-1;
    
    var p = (a.j == b.j)?1:Math.abs(a.i - b.i)/(Math.abs(a.i - b.i) + Math.abs(a.j - b.j));
    
    var index = 0;
    var i=a.i, j=a.j;
    var r = [];
    
    for (let index=0;index<10000;index++) { //limit prevents inf loop if I've miscalculated
        r.push({i:i, j:j}); //first time pushes a.
        if (i==b.i && j==b.j) break; //last time pushed b
        if (dither(p,index)) i+=di; else j+=dj;
    }
    
    return r;
}


    
function levelTest(pi=0,pj=0){
    var arr = [];
    for (let i = pi; i < pi+20; i++) {
      arr[i] = [];
      for (let j = pj; j < pj+20; j++) {
        arr[i][j] = level(i, j);
      }
    }
    console.table(arr, arr.length);
}

//Lowest levels darkest.
//Goes from 0 (black) to 250 (very light grey) as n goes from 0 to infinity.
function greyLevel(n){  
    //as n goes goes from 1 to infinity.
    var greyLevel = Math.floor(250 - 250/Math.pow(1.2,n));
    return "rgb("+greyLevel+","+greyLevel+","+greyLevel+")";
}


function cyclicColor(n){
    var rgb =['Red','Orange','Brown','Chartreuse','MediumTurquoise','DarkBlue','Magenta','Purple'];
    return rgb[n%8];
}

var seed = 0;
function nextRandom(aSeed){ //pass in a value to initialize seed, thereafter use parameterless for a reproducable sequence
    if (aSeed == undefined) aSeed = seed;
    seed = (aSeed * 9301 + 49297) % 233280;
    return seed/233280;
}
    
function randomRGB(aSeed){
    return {r:Math.floor(nextRandom(aSeed)*256), g:Math.floor(nextRandom()*256), b:Math.floor(nextRandom()*256)};
}

function randomRGBString(aSeed){
    var rgb = randomRGB(aSeed);
    return "rgb("+rgb.r+","+rgb.g+","+rgb.b+")";
}

    
//returns coords of valid pyr node nearest to i,j, or null if none found within window of radius r.
function scanWindow(i,j,r){
    var nearii,nearjj;
    var nearD2 = Number.MAX_SAFE_INTEGER;
    for (var ii = i-r; ii<=i+r; ii++) {
        if (ii>=0 && ii < pyrHeight ) for (var jj = j-r; jj<=j+r;jj++){
            if (jj>=0 && jj < pyrWidth) {
                if (pyr[ii][jj]) {
                    let thisD2 = d2(i,j,ii,jj);
                    if (thisD2 < nearD2) {
                        nearii = ii; nearjj = jj; nearD2 = thisD2;
                    }
                }
            }
        }
    }
    if (nearii >=0) return {i:nearii,j:nearjj}; else return null;
}

 
//rgbString is randomRGBSting(something) or cyclicColor(something) etc
function drawBetween(i1,j1,i2,j2,rgbString){
    imgContext.beginPath();
    imgContext.moveTo(j1,i1);
    imgContext.lineTo(j2,i2);
    imgContext.strokeStyle = rgbString;
    imgContext.stroke();
}
    
// graph generation
function linkClosestPair(i,j,dotKs){
    if (dotKs.length < 2 ) return;
    var copy = dotKs.slice();
    var first = minD2(i,j,copy);
    copy.splice(first.m,1); //remove first.k
    var second = minD2(i,j,copy);
    drawBetween(dots[first.k].i,dots[first.k].j,dots[second.k].i,dots[second.k].j,'Black');
}

//assumes dotKs.length >= 1
function wrap(dotKs){
    var firstDot = dots[dotKs[0]];
    var priorDot = firstDot;
    
    for (let m = 1; m < dotKs.length; m++){
        let dot = dots[dotKs[m]];
        drawBetween(priorDot.i,priorDot.j,dot.i,dot.j,'Black');
        priorDot = dot;
    }
    
    if (dotKs.length > 2) drawBetween(priorDot.i,priorDot.j,firstDot.i,firstDot.j,'Black');
       
}

//assumes image values are integers
function renderImageKs(){
    
    for (let i=0;i<imageHeight;i++) for (let j=0;j<imageWidth;j++) if (image[i][j]) {
            let ix = 4*(i*imageWidth + j);
            let k = image[i][j];
            if (k<0) k = dots.length - k;
            let rgb = randomRGB(k);
            rgba[ix] = rgb.r;
            rgba[ix+1] = rgb.g;
            rgba[ix+2] = rgb.b;
            rgba[ix+3] = 0xffff;
    }
    imgContext.putImageData(imgData, 0, 0);
}
    
function getIndexLevel(){return indexLevel;}
    
return { 
        getIndexLevel:getIndexLevel,
        d2:d2,
        d2ToChildren:d2ToChildren,
        d2BetweenAdjacentChildren:d2BetweenAdjacentChildren,
        clearImage: clearImage,
        level:level,
        hvDistToParent:hvDistToParent,
        hvDistBetweenSibs:hvDistBetweenSibs,
        sumLevels:sumLevels,
        depthFirstMarkup:depthFirstMarkup,
        footprint:footprint,
        footprints:footprints,
        headprints:headprints,
        testGELevel:testGELevel,
        renderImageToRGBA:renderImageToRGBA,
        clearPyr:clearPyr,
        cellHeightFirstMarkup:cellHeightFirstMarkup,
        testChildren: testChildren,
        testPyrCoords: testPyrCoords,
        testParents: testParents,
        levelTest: levelTest,
        stLine: stLine,
        dumpLine:dumpLine,
        sumImage:sumImage,
        testNeighbors:testNeighbors,
        greyLevel:greyLevel,
        portrayLevel:portrayLevel,
        delaunay:delaunay,
        closestDot:closestDot,
        voronoi:voronoi,
        renderImageKs:renderImageKs,
        scanWindow:scanWindow,
        hopImage:hopImage,
        hopImage2:hopImage2,
        hopDistance:hopDistance,
        avgHopDistance:avgHopDistance,
    };
}
